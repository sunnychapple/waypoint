import { OverviewScriptResultSchema, VideoSlidesResultSchema } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";

export type OverviewKind = "audio" | "video";
export type OverviewState = "script" | "rendering" | "ready" | "failed";
export type Overview = {
  id: string; // the job id
  sessionId: string | null;
  kind: OverviewKind;
  title: string;
  script: string; // the result JSON
  state: OverviewState;
  file: string | null; // relative to Documents
  durationMs: number | null;
  lineStarts: number[];
  voices: string;
  createdAt: number;
};

type Row = { id: string; session_id: string | null; kind: OverviewKind; title: string; script: string; state: OverviewState; file: string | null; duration_ms: number | null; line_starts: string; voices: string; created_at: number };
const COLUMNS = "id, session_id, kind, title, script, state, file, duration_ms, line_starts, voices, created_at";

function fromRow(r: Row): Overview {
  const starts: unknown = JSON.parse(r.line_starts);
  return {
    id: r.id,
    sessionId: r.session_id,
    kind: r.kind,
    title: r.title,
    script: r.script,
    state: r.state,
    file: r.file,
    durationMs: r.duration_ms,
    lineStarts: Array.isArray(starts) ? starts.filter((n): n is number => typeof n === "number") : [],
    voices: r.voices,
    createdAt: r.created_at,
  };
}

// The opened result of an overview_script (audio) or video_slides (video) job. Throws when it is not the contract.
export function saveOverview(db: SqlDb, kind: OverviewKind, job: { id: string; sessionId: string | null }, text: string, now: number): void {
  const value: unknown = JSON.parse(text);
  const parsed = kind === "audio" ? OverviewScriptResultSchema.parse(value) : VideoSlidesResultSchema.parse(value);
  db.run(`INSERT OR REPLACE INTO overviews (id, session_id, kind, title, script, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    job.id,
    job.sessionId,
    kind,
    parsed.title,
    JSON.stringify(parsed),
    now,
  ]);
}

export function getOverview(db: SqlDb, id: string): Overview | null {
  const row = db.get<Row>(`SELECT ${COLUMNS} FROM overviews WHERE id = ?`, [id]);
  return row === null ? null : fromRow(row);
}

export function overviewsForSession(db: SqlDb, sessionId: string): Overview[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM overviews WHERE session_id = ? ORDER BY created_at DESC`, [sessionId]).map(fromRow);
}

// Overviews whose voices still have to be rendered (a render cut off by the app closing starts again).
export function overviewsToRender(db: SqlDb): Overview[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM overviews WHERE state IN ('script', 'rendering') ORDER BY created_at`).map(fromRow);
}

export function setRendering(db: SqlDb, id: string): void {
  db.run("UPDATE overviews SET state = 'rendering' WHERE id = ?", [id]);
}

export function setRendered(db: SqlDb, id: string, r: { file: string; durationMs: number; lineStarts: number[]; voices: string }): void {
  db.run("UPDATE overviews SET state = 'ready', file = ?, duration_ms = ?, line_starts = ?, voices = ? WHERE id = ?", [r.file, r.durationMs, JSON.stringify(r.lineStarts), r.voices, id]);
}

export function setRenderFailed(db: SqlDb, id: string): void {
  db.run("UPDATE overviews SET state = 'failed' WHERE id = ?", [id]);
}

export type ScriptLine = { voice: "A" | "B"; text: string };

// What the voices say: an audio overview's lines as written; a video's narration, one line per slide, all host A.
export function scriptLines(overview: Overview): ScriptLine[] {
  const value: unknown = JSON.parse(overview.script);
  if (overview.kind === "audio") return OverviewScriptResultSchema.parse(value).lines.map((l) => ({ voice: l.host, text: l.text }));
  return VideoSlidesResultSchema.parse(value).slides.map((s) => ({ voice: "A", text: s.narration }));
}

// The line playing at a moment, for highlighting it in the player.
export function lineAt(lineStarts: number[], ms: number): number {
  let index = -1;
  for (let i = 0; i < lineStarts.length; i++) if ((lineStarts[i] ?? 0) <= ms) index = i;
  return Math.max(0, index);
}
