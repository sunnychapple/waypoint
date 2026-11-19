import type { SqlDb } from "../db/sql.ts";
import type { Embedder } from "./indexer.ts";
import { toFtsQuery } from "./fts.ts";
import { fuse, quantize, similarity, type StoredVector } from "./vectors.ts";

export type Hit = {
  chunkId: number;
  sessionId: string;
  sessionTitle: string;
  spaceName: string;
  tStart: number;
  captureId: string | null;
  snippet: string;
};

const KEYWORD_LIMIT = 50;
const VECTOR_LIMIT = 50;
const MIN_SIMILARITY = 0.25;
const DEFAULT_LIMIT = 20;
const SNIPPET_CHARS = 140;

type CachedVector = { chunkId: number; spaceId: string; vector: StoredVector };

// Loaded vectors, keyed by model_version. indexSession clears it after writing.
const vectorCache = new Map<string, CachedVector[]>();

export function clearVectorCache(): void {
  vectorCache.clear();
}

function vectorsFor(db: SqlDb, modelVersion: string): CachedVector[] {
  const cached = vectorCache.get(modelVersion);
  if (cached) return cached;
  const rows = db.all<{ chunk_id: number; space_id: string; scale: number; vector: Uint8Array }>(
    `SELECT s.chunk_id, ses.space_id, s.scale, s.vector
     FROM search_index s
     JOIN chunks c ON c.id = s.chunk_id
     JOIN sessions ses ON ses.id = c.session_id
     WHERE s.model_version = ?`,
    [modelVersion],
  );
  const loaded = rows.map((r) => ({ chunkId: r.chunk_id, spaceId: r.space_id, vector: { scale: r.scale, bytes: r.vector } }));
  vectorCache.set(modelVersion, loaded);
  return loaded;
}

export async function searchNotes(
  db: SqlDb,
  embedder: Embedder,
  query: string,
  options: { spaceId?: string; limit?: number },
): Promise<Hit[]> {
  const match = toFtsQuery(query);
  if (match === null) return [];
  const spaceId = options.spaceId ?? null;
  const limit = options.limit ?? DEFAULT_LIMIT;

  const keyword = db.all<{ id: number; snip: string }>(
    `SELECT chunks_fts.rowid AS id, snippet(chunks_fts, 0, '[', ']', '…', 12) AS snip
     FROM chunks_fts
     JOIN chunks c ON c.id = chunks_fts.rowid
     JOIN sessions s ON s.id = c.session_id
     WHERE chunks_fts MATCH ? AND (? IS NULL OR s.space_id = ?)
     ORDER BY bm25(chunks_fts)
     LIMIT ${KEYWORD_LIMIT}`,
    [match, spaceId, spaceId],
  );

  const vectorIds: number[] = [];
  const [queryVector = []] = await embedder.embed([query]);
  if (queryVector.length > 0) {
    const q = quantize(queryVector);
    vectorIds.push(
      ...vectorsFor(db, embedder.modelVersion)
        .filter((c) => (options.spaceId === undefined || c.spaceId === options.spaceId) && c.vector.bytes.length === q.bytes.length)
        .map((c) => ({ chunkId: c.chunkId, score: similarity(q, c.vector) }))
        .filter((c) => c.score >= MIN_SIMILARITY)
        .sort((a, b) => b.score - a.score)
        .slice(0, VECTOR_LIMIT)
        .map((c) => c.chunkId),
    );
  }

  const snippets = new Map(keyword.map((k) => [k.id, k.snip]));
  const fused = fuse([keyword.map((k) => k.id), vectorIds]).slice(0, limit);
  const hits: Hit[] = [];
  for (const id of fused) {
    const row = db.get<{ session_id: string; session_title: string; space_name: string; t_start: number; capture_id: string | null; text: string }>(
      `SELECT c.session_id, s.title AS session_title, sp.name AS space_name, c.t_start, c.capture_id, c.text
       FROM chunks c
       JOIN sessions s ON s.id = c.session_id
       JOIN spaces sp ON sp.id = s.space_id
       WHERE c.id = ?`,
      [id],
    );
    if (!row) continue;
    hits.push({
      chunkId: id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      spaceName: row.space_name,
      tStart: row.t_start,
      captureId: row.capture_id,
      snippet: snippets.get(id) ?? row.text.slice(0, SNIPPET_CHARS),
    });
  }
  return hits;
}
