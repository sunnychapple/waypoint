import { DiagramResultSchema, MiniAppResultSchema, PracticeSetResultSchema, type DiagramResult, type MiniAppResult, type PracticeSetResult } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";

export type MadeKind = "diagram" | "mini_app" | "practice";
export type MadeItem =
  | { id: string; sessionId: string | null; kind: "diagram"; title: string; body: DiagramResult; createdAt: number }
  | { id: string; sessionId: string | null; kind: "mini_app"; title: string; body: MiniAppResult; createdAt: number }
  | { id: string; sessionId: string | null; kind: "practice"; title: string; body: PracticeSetResult; createdAt: number };

type Row = { id: string; session_id: string | null; kind: MadeKind; title: string; body: string; created_at: number };

const SCHEMAS = { diagram: DiagramResultSchema, mini_app: MiniAppResultSchema, practice: PracticeSetResultSchema } as const;

// The opened result of a diagram, mini app or practice job (RESULT_SAVERS). Throws when it is not the contract.
export function saveMade(db: SqlDb, kind: MadeKind, job: { id: string; sessionId: string | null }, text: string, now: number): void {
  const body = SCHEMAS[kind].parse(JSON.parse(text));
  db.run("INSERT OR REPLACE INTO made (id, session_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    job.id,
    job.sessionId,
    kind,
    body.title,
    JSON.stringify(body),
    now,
  ]);
}

function fromRow(r: Row): MadeItem | null {
  const base = { id: r.id, sessionId: r.session_id, title: r.title, createdAt: r.created_at };
  const value: unknown = JSON.parse(r.body);
  if (r.kind === "diagram") {
    const body = DiagramResultSchema.safeParse(value);
    return body.success ? { ...base, kind: "diagram", body: body.data } : null;
  }
  if (r.kind === "mini_app") {
    const body = MiniAppResultSchema.safeParse(value);
    return body.success ? { ...base, kind: "mini_app", body: body.data } : null;
  }
  const body = PracticeSetResultSchema.safeParse(value);
  return body.success ? { ...base, kind: "practice", body: body.data } : null;
}

export function getMade(db: SqlDb, id: string): MadeItem | null {
  const row = db.get<Row>("SELECT id, session_id, kind, title, body, created_at FROM made WHERE id = ?", [id]);
  return row === null ? null : fromRow(row);
}

export function madeForSession(db: SqlDb, sessionId: string): MadeItem[] {
  return db
    .all<Row>("SELECT id, session_id, kind, title, body, created_at FROM made WHERE session_id = ? ORDER BY created_at DESC", [sessionId])
    .map(fromRow)
    .filter((item): item is MadeItem => item !== null);
}
