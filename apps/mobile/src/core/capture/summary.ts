import { z } from "zod";
import type { SqlDb } from "../db/sql.ts";
import { inputBudget, packUnits, type Unit } from "../study/generate.ts";
import { titleFromText } from "./pages.ts";

// What the iPhone's model is asked for (modules/waypoint-model summarize): a title and a summary of some text.
export type SummaryPort = { contextSize(): number; summarize(text: string): Promise<unknown> };
export type MadeSummary = { title: string; summary: string };
export type SummaryInfo = { summary: string | null; summaryAuto: boolean; titleAuto: boolean };

export const SUMMARY_MAX_CHARS = 600;
export const SUMMARY_EDIT_MAX_CHARS = 2000;

export function getSummary(db: SqlDb, sessionId: string): SummaryInfo | null {
  const row = db.get<{ summary: string | null; summary_auto: number; title_auto: number }>(
    "SELECT summary, summary_auto, title_auto FROM sessions WHERE id = ?",
    [sessionId],
  );
  return row === null ? null : { summary: row.summary, summaryAuto: row.summary_auto === 1, titleAuto: row.title_auto === 1 };
}

// A finished recording with words, whose summary the app writes and has not written yet.
export function needsSummary(db: SqlDb, sessionId: string): boolean {
  return (
    db.get(
      `SELECT 1 AS n FROM sessions s
       WHERE s.id = ? AND s.kind = 'recording' AND s.state IN ('saved', 'interrupted') AND s.transcript = 'done'
         AND s.summary_auto = 1 AND s.summary IS NULL
         AND EXISTS (SELECT 1 FROM segments g WHERE g.session_id = s.id AND g.source = 'device' AND trim(g.text) <> '')`,
      [sessionId],
    ) !== null
  );
}

// Recording more makes the app's summary out of date, so it is cleared and written again. A summary the person wrote stays.
export function staleSummary(db: SqlDb, sessionId: string): void {
  db.run("UPDATE sessions SET summary = NULL WHERE id = ? AND summary_auto = 1 AND summary IS NOT NULL", [sessionId]);
}

// Writes what the model made. A title or a summary the person typed is never replaced.
export function applySummary(db: SqlDb, sessionId: string, made: MadeSummary): void {
  db.run(
    `UPDATE sessions SET title = CASE WHEN title_auto = 1 THEN ? ELSE title END,
       summary = CASE WHEN summary_auto = 1 THEN ? ELSE summary END
     WHERE id = ? AND (title_auto = 1 OR summary_auto = 1)`,
    [made.title, made.summary, sessionId],
  );
}

// The person's own summary, trimmed. Empty text changes nothing. From then on the app leaves the summary alone.
export function editSummary(db: SqlDb, sessionId: string, text: string): void {
  const trimmed = [...text.trim()].slice(0, SUMMARY_EDIT_MAX_CHARS).join("").trim();
  if (trimmed === "") return;
  db.run("UPDATE sessions SET summary = ?, summary_auto = 0 WHERE id = ?", [trimmed, sessionId]);
}

const madeSchema = z.object({ title: z.string(), summary: z.string() });
// The permissive mode answers in plain text, which arrives as { plainText } (see Drafts.swift).
const plainSchema = z.object({ plainText: z.string() });

// Cuts to at most `max` characters, the "…" included, at a word boundary when there is one.
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head) + "…";
}

// The model's reply as a title of at most 60 characters and a summary of at most 600, or null when either is empty.
export function cleanSummary(raw: unknown): MadeSummary | null {
  let title = "";
  let summary = "";
  const made = madeSchema.safeParse(raw);
  if (made.success) {
    title = made.data.title;
    summary = made.data.summary;
  } else {
    const plain = plainSchema.safeParse(raw);
    if (!plain.success) return null;
    const text = plain.data.plainText.replace(/\*\*/g, "");
    title = /TITLE\s*:\s*(.+)/i.exec(text)?.[1] ?? "";
    summary = (/SUMMARY\s*:\s*([\s\S]+)/i.exec(text)?.[1] ?? "").split(/\n\s*TITLE\s*:/i)[0] ?? "";
  }
  const shortTitle = titleFromText(title.replace(/["“”#*]/g, " ").replace(/\s+/g, " ").trim().replace(/[.:;,]+$/, ""), "");
  const shortSummary = summary.replace(/\s+/g, " ").trim();
  if (shortTitle === "" || shortSummary === "") return null;
  return { title: shortTitle, summary: fit(shortSummary, SUMMARY_MAX_CHARS) };
}

// The text in pieces that fit the model, each summarized; when there is more than one, their summaries are summarized
// the same way until one is left. Null when there is no text or nothing usable came back. Model errors are thrown.
export async function summarizeUnits(port: SummaryPort, units: Unit[]): Promise<MadeSummary | null> {
  const budget = inputBudget(port.contextSize());
  const join = (group: Unit[]): string => group.map((unit) => unit.text).join("\n\n");
  let texts = packUnits(units.filter((unit) => unit.text.trim() !== ""), budget).map(join);
  while (true) {
    const made: MadeSummary[] = [];
    for (const text of texts) {
      const one = cleanSummary(await port.summarize(text));
      if (one !== null) made.push(one);
    }
    const [first] = made;
    if (first === undefined || made.length === 1) return first ?? null;
    const next = packUnits(made.map((m) => ({ text: m.summary, captureId: null, t: null })), budget).map(join);
    // The summaries did not get any fewer: the first piece's summary stands.
    if (next.length >= texts.length) return first;
    texts = next;
  }
}
