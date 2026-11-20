import { JOB_TEXT_MAX_CHARS, ResearchResultSchema, type ResearchDepth } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";

export type ResearchItem = {
  id: string; // the job id
  sessionId: string | null;
  question: string;
  depth: ResearchDepth;
  answer: string;
  sources: { n: number; url: string; title: string }[];
  createdAt: number;
};

type Row = { id: string; session_id: string | null; question: string; depth: ResearchDepth; answer: string; sources: string; created_at: number };

function fromRow(r: Row): ResearchItem {
  const sources = ResearchResultSchema.shape.sources.safeParse(JSON.parse(r.sources));
  return { id: r.id, sessionId: r.session_id, question: r.question, depth: r.depth, answer: r.answer, sources: sources.success ? sources.data : [], createdAt: r.created_at };
}

// The opened result of a research job (RESULT_SAVERS). Throws on a result that is not ResearchResultSchema.
export function saveResearch(db: SqlDb, job: { id: string; sessionId: string | null; detail: string }, text: string, now: number): void {
  const result = ResearchResultSchema.parse(JSON.parse(text));
  const detail = JSON.parse(job.detail) as { question?: unknown; depth?: unknown };
  const question = typeof detail.question === "string" ? detail.question : "";
  const depth = detail.depth === "standard" || detail.depth === "deep" ? detail.depth : "quick";
  db.run(
    "INSERT OR REPLACE INTO research (id, session_id, question, depth, answer, sources, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [job.id, job.sessionId, question, depth, result.answer, JSON.stringify(result.sources), now],
  );
}

export function getResearch(db: SqlDb, id: string): ResearchItem | null {
  const row = db.get<Row>("SELECT id, session_id, question, depth, answer, sources, created_at FROM research WHERE id = ?", [id]);
  return row === null ? null : fromRow(row);
}

export function researchForSession(db: SqlDb, sessionId: string): ResearchItem[] {
  return db
    .all<Row>("SELECT id, session_id, question, depth, answer, sources, created_at FROM research WHERE session_id = ? ORDER BY created_at DESC", [sessionId])
    .map(fromRow);
}

// The session's own words, for "Include my notes": the transcript made on this iPhone, then page text, cut at a word
// boundary to the research cap (8,000 characters). Shown in full before it is sent.
export function notesForResearch(db: SqlDb, sessionId: string, max: number = JOB_TEXT_MAX_CHARS.research): string {
  const transcript = db
    .all<{ text: string }>("SELECT text FROM segments WHERE session_id = ? AND source = 'device' ORDER BY t_start", [sessionId])
    .map((r) => r.text);
  const pages = db
    .all<{ found_text: string | null }>("SELECT found_text FROM captures WHERE session_id = ? AND kind IN ('page', 'photo') ORDER BY position, t", [sessionId])
    .map((r) => r.found_text ?? "");
  const text = [...transcript, ...pages].join(" ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return space > 0 ? cut.slice(0, space) : cut;
}
