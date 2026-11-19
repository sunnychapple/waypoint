import type { SqlDb } from "../db/sql.ts";
import { createSession, type SessionRow } from "./sessions.ts";

type Deps = { now: () => number; newId: () => string };

// Writes a new pages session. Its title is set by the caller ("Pages" until page 1 is read).
export function startPagesSession(db: SqlDb, deps: Deps, spaceId: string, title: string): SessionRow {
  return createSession(db, deps, { spaceId, kind: "pages", title, state: "saved" });
}

// Adds pages after the last one, in the order given. Returns the new capture ids.
export function addPages(db: SqlDb, deps: Deps, sessionId: string, files: string[]): string[] {
  const last = db.get<{ top: number | null }>(
    "SELECT max(position) AS top FROM captures WHERE session_id = ? AND kind = 'page'",
    [sessionId],
  );
  let next = (last?.top ?? -1) + 1;
  const ids: string[] = [];
  db.transaction(() => {
    for (const file of files) {
      const id = deps.newId();
      db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES (?, ?, 'page', 0, ?, ?)", [
        id,
        sessionId,
        next,
        file,
      ]);
      ids.push(id);
      next += 1;
    }
  });
  return ids;
}

export function listPages(
  db: SqlDb,
  sessionId: string,
): { id: string; file: string; position: number; foundText: string | null }[] {
  return db
    .all<{ id: string; file: string; position: number; found_text: string | null }>(
      "SELECT id, file, position, found_text FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id",
      [sessionId],
    )
    .map((row) => ({ id: row.id, file: row.file, position: row.position, foundText: row.found_text }));
}

// Renumbers the session's pages 0..n-1 in their current order.
function renumber(db: SqlDb, sessionId: string): void {
  const ids = db.all<{ id: string }>(
    "SELECT id FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id",
    [sessionId],
  );
  ids.forEach((row, index) => {
    db.run("UPDATE captures SET position = ? WHERE id = ?", [index, row.id]);
  });
}

// Removes one page and returns its file path, which the caller deletes.
export function removePage(db: SqlDb, captureId: string): string {
  const row = db.get<{ file: string; session_id: string }>(
    "SELECT file, session_id FROM captures WHERE id = ? AND kind = 'page'",
    [captureId],
  );
  if (!row) throw new Error(`no such page: ${captureId}`);
  db.transaction(() => {
    db.run("DELETE FROM captures WHERE id = ?", [captureId]);
    renumber(db, row.session_id);
  });
  return row.file;
}

// Moves one page to a position (clamped to the pages that exist) and renumbers 0..n-1.
export function movePage(db: SqlDb, captureId: string, toPosition: number): void {
  const row = db.get<{ session_id: string }>("SELECT session_id FROM captures WHERE id = ? AND kind = 'page'", [captureId]);
  if (!row) throw new Error(`no such page: ${captureId}`);
  db.transaction(() => {
    const ids = db
      .all<{ id: string }>("SELECT id FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id", [
        row.session_id,
      ])
      .map((r) => r.id)
      .filter((id) => id !== captureId);
    const index = Math.min(Math.max(0, Math.trunc(toPosition)), ids.length);
    ids.splice(index, 0, captureId);
    ids.forEach((id, i) => {
      db.run("UPDATE captures SET position = ? WHERE id = ?", [i, id]);
    });
  });
}

// Stores the text read from a page and marks the session as needing its search index again.
export function setPageText(db: SqlDb, captureId: string, text: string, linesJson: string): void {
  db.transaction(() => {
    const row = db.get<{ session_id: string }>("SELECT session_id FROM captures WHERE id = ?", [captureId]);
    if (!row) throw new Error(`no such capture: ${captureId}`);
    db.run("UPDATE captures SET found_text = ?, found_lines = ? WHERE id = ?", [text, linesJson, captureId]);
    db.run("UPDATE sessions SET indexed_at = NULL WHERE id = ?", [row.session_id]);
  });
}

// Pages and photos not read yet, oldest first. An empty text ("" after a failed read) is not picked again.
export function pagesToRead(db: SqlDb, limit: number): { id: string; file: string }[] {
  return db.all<{ id: string; file: string }>(
    "SELECT id, file FROM captures WHERE kind IN ('page', 'photo') AND found_text IS NULL ORDER BY rowid LIMIT ?",
    [limit],
  );
}

// Words in all texts that exist. Null (not read yet) counts as nothing.
export function wordCount(texts: (string | null)[]): number {
  return texts.reduce<number>((total, text) => total + (text === null ? 0 : text.split(/\s+/).filter((w) => w.length > 0).length), 0);
}

// The first line with at least three letters, trimmed to 60 characters at a word boundary.
export function titleFromText(text: string | null, fallback: string): string {
  if (text === null) return fallback;
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => (l.match(/\p{L}/gu) ?? []).length >= 3);
  if (line === undefined) return fallback;
  const chars = [...line];
  if (chars.length <= 60) return line;
  const cut = chars.slice(0, 60).join("");
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
