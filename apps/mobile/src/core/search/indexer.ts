import { studyLines } from "../capture/segments.ts";
import type { SqlDb } from "../db/sql.ts";
import { chunkCapture, chunkTranscript, type ChunkDraft } from "./chunks.ts";
import { clearVectorCache } from "./query.ts";
import { hasDirection, quantize } from "./vectors.ts";

export type Embedder = { modelVersion: string; embed(texts: string[]): Promise<number[][]> };

const EMBED_BATCH = 16;

// Finished sessions (saved, or interrupted by a crash and recovered) that have not been indexed yet, oldest first.
export function sessionsToIndex(db: SqlDb, limit: number): string[] {
  return db
    .all<{ id: string }>(
      "SELECT id FROM sessions WHERE state IN ('saved', 'interrupted') AND indexed_at IS NULL ORDER BY started_at ASC LIMIT ?",
      [limit],
    )
    .map((row) => row.id);
}

// Replaces the session's chunks, vectors and keyword rows. Returns the number of chunks written.
export async function indexSession(db: SqlDb, embedder: Embedder, sessionId: string, now: number): Promise<number> {
  const before = db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = ?", [sessionId]);
  if (!before) return 0;
  // The transcript as the person edited it, without hidden lines (studyLines). Edits made while the embedder runs are seen too.
  const read = () => ({
    segments: studyLines(db, sessionId),
    captures: db.all<{ id: string; kind: "page" | "photo"; t: number; found_text: string | null }>(
      "SELECT id, kind, t, found_text FROM captures WHERE session_id = ? AND kind IN ('page', 'photo') ORDER BY t, position",
      [sessionId],
    ),
  });
  const { segments, captures } = read();
  // What was read, to compare inside the transaction: text written while the embedder ran (a transcription, a page)
  // leaves indexed_at as it was, so only this comparison notices it.
  const seen = JSON.stringify({ segments, captures });
  const drafts: ChunkDraft[] = [
    ...chunkTranscript(segments),
    ...captures.flatMap((c) => chunkCapture({ id: c.id, kind: c.kind, t: c.t, text: c.found_text ?? "" })),
  ];

  const texts = drafts.map((d) => d.text);
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    vectors.push(...(await embedder.embed(texts.slice(i, i + EMBED_BATCH))));
  }
  const stored = vectors.map((v) => (hasDirection(v) ? quantize(v) : null));

  let written = 0;
  let replaced = false;
  db.transaction(() => {
    const after = db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = ?", [sessionId]);
    // Changed meanwhile: nothing is written and indexed_at stays as it was, so the next pass indexes the new text.
    if (!after || after.indexed_at !== before.indexed_at || JSON.stringify(read()) !== seen) return;
    db.run("DELETE FROM chunks WHERE session_id = ?", [sessionId]);
    drafts.forEach((draft, i) => {
      const inserted = db.run(
        "INSERT INTO chunks (session_id, source, capture_id, t_start, t_end, text) VALUES (?, ?, ?, ?, ?, ?)",
        [sessionId, draft.source, draft.captureId, draft.tStart, draft.tEnd, draft.text],
      );
      const vector = stored[i];
      if (vector) {
        db.run("INSERT INTO search_index (chunk_id, model_version, dim, scale, vector) VALUES (?, ?, ?, ?, ?)", [
          inserted.lastInsertRowId,
          embedder.modelVersion,
          vector.bytes.length,
          vector.scale,
          vector.bytes,
        ]);
      }
    });
    db.run("UPDATE sessions SET indexed_at = ? WHERE id = ?", [now, sessionId]);
    written = drafts.length;
    replaced = true;
  });
  if (replaced) clearVectorCache();
  return written;
}

// Sessions with any vector from another model version are marked for re-indexing. Returns how many.
export function markStale(db: SqlDb, modelVersion: string): number {
  return db.run(
    `UPDATE sessions SET indexed_at = NULL
     WHERE indexed_at IS NOT NULL
       AND id IN (
         SELECT c.session_id FROM chunks c JOIN search_index s ON s.chunk_id = c.id WHERE s.model_version <> ?
       )`,
    [modelVersion],
  ).changes;
}

export function indexStatus(db: SqlDb, modelVersion: string): { sessions: number; indexed: number; chunks: number; vectors: number } {
  const count = (sql: string, params: string[] = []): number => db.get<{ n: number }>(sql, params)?.n ?? 0;
  return {
    sessions: count("SELECT count(*) AS n FROM sessions WHERE state IN ('saved', 'interrupted')"),
    indexed: count("SELECT count(*) AS n FROM sessions WHERE state IN ('saved', 'interrupted') AND indexed_at IS NOT NULL"),
    chunks: count("SELECT count(*) AS n FROM chunks"),
    vectors: count("SELECT count(*) AS n FROM search_index WHERE model_version = ?", [modelVersion]),
  };
}
