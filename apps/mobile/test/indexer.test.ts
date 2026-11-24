import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { indexSession, indexStatus, markStale, sessionsToIndex, type Embedder } from "../src/core/search/indexer.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('space-1', 'My notes', 1, 0, 0)");
});

function addSession(id: string, state: "saved" | "recording" | "interrupted", startedAt: number, segments: string[], page?: string): void {
  db.run(
    "INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at, recorded_ms) VALUES (?, 'space-1', 'recording', ?, ?, 'done', ?, 0)",
    [id, `Session ${id}`, state, startedAt],
  );
  segments.forEach((text, i) => {
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES (?, ?, ?, ?, 'device')", [id, i * 1000, i * 1000 + 900, text]);
  });
  if (page !== undefined) {
    db.run("INSERT INTO captures (id, session_id, kind, t, file, found_text) VALUES (?, ?, 'page', 0, 'page.jpg', ?)", [`${id}-page`, id, page]);
  }
}

function fakeEmbedder(table: Record<string, number[]>, modelVersion = "test-1"): Embedder {
  return { modelVersion, embed: async (texts) => texts.map((text) => table[text] ?? []) };
}

const vectors = { "supply and demand": [1, 0, 0], photosynthesis: [0, 0, 1] };

describe("indexer", () => {
  it("indexes a saved session into chunks, vectors, keyword rows and indexed_at", async () => {
    addSession("s1", "saved", 100, ["supply and demand"], "photosynthesis");
    const written = await indexSession(db, fakeEmbedder(vectors), "s1", 5000);
    expect(written).toBe(2);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM chunks WHERE session_id = 's1'")?.n).toBe(2);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM search_index WHERE model_version = 'test-1'")?.n).toBe(2);
    expect(db.all("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'photosynthesis'")).toHaveLength(1);
    expect(db.get<{ indexed_at: number }>("SELECT indexed_at FROM sessions WHERE id = 's1'")?.indexed_at).toBe(5000);
  });

  it("re-indexing a session replaces its rows instead of duplicating them", async () => {
    addSession("s1", "saved", 100, ["supply and demand"], "photosynthesis");
    await indexSession(db, fakeEmbedder(vectors), "s1", 5000);
    await indexSession(db, fakeEmbedder(vectors), "s1", 6000);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM chunks WHERE session_id = 's1'")?.n).toBe(2);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM search_index")?.n).toBe(2);
    expect(db.all("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'supply'")).toHaveLength(1);
  });

  it("sessionsToIndex skips a session that is still recording", () => {
    addSession("saved-one", "saved", 100, ["a"]);
    addSession("recording-one", "recording", 50, ["b"]);
    expect(sessionsToIndex(db, 3)).toEqual(["saved-one"]);
  });

  it("an interrupted session (a recording cut off by a crash) is indexed and counted like a saved one", () => {
    addSession("saved-one", "saved", 100, ["a"]);
    addSession("cut-off", "interrupted", 50, ["b"]);
    expect(sessionsToIndex(db, 3)).toEqual(["cut-off", "saved-one"]);
    expect(indexStatus(db, "test-1")).toMatchObject({ sessions: 2, indexed: 0 });
  });

  it("text written while the embedder runs (indexed_at still NULL) is not lost: nothing is written and the session stays to index", async () => {
    addSession("s1", "saved", 100, ["supply and demand"]);
    const embedder: Embedder = {
      modelVersion: "test-1",
      embed: async (texts) => {
        db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', 5000, 5900, 'photosynthesis', 'device')");
        return texts.map(() => [1, 0, 0]);
      },
    };
    expect(await indexSession(db, embedder, "s1", 6000)).toBe(0);
    expect(sessionsToIndex(db, 3)).toEqual(["s1"]);
    expect(await indexSession(db, fakeEmbedder(vectors), "s1", 7000)).toBe(1);
    expect(db.all("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'photosynthesis'")).toHaveLength(1);
  });

  it("markStale flags a session whose vectors came from another model version", async () => {
    addSession("s1", "saved", 100, ["supply and demand"]);
    await indexSession(db, fakeEmbedder(vectors, "test-1"), "s1", 5000);
    expect(markStale(db, "test-1")).toBe(0);
    expect(markStale(db, "test-2")).toBe(1);
    expect(db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = 's1'")?.indexed_at).toBeNull();
    expect(indexStatus(db, "test-1")).toEqual({ sessions: 1, indexed: 0, chunks: 1, vectors: 1 });
  });

  it("an empty vector still stores the chunk for keyword search", async () => {
    addSession("s1", "saved", 100, ["unknown words here"]);
    expect(await indexSession(db, fakeEmbedder({}), "s1", 5000)).toBe(1);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM chunks")?.n).toBe(1);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM search_index")?.n).toBe(0);
    expect(db.all("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'unknown'")).toHaveLength(1);
  });

  it("writes nothing when the session is deleted while it is being embedded", async () => {
    addSession("s1", "saved", 100, ["supply and demand"]);
    const embedder: Embedder = {
      modelVersion: "test-1",
      embed: async (texts) => {
        db.run("DELETE FROM sessions WHERE id = 's1'");
        return texts.map(() => [1, 0, 0]);
      },
    };
    expect(await indexSession(db, embedder, "s1", 5000)).toBe(0);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM chunks")?.n).toBe(0);
  });

  it("an all-zero vector is stored as a chunk without a vector, and the session is marked indexed", async () => {
    addSession("s1", "saved", 100, ["silence"]);
    expect(await indexSession(db, fakeEmbedder({ silence: [0, 0, 0] }), "s1", 5000)).toBe(1);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM search_index")?.n).toBe(0);
    expect(sessionsToIndex(db, 3)).toEqual([]);
  });

  it("a re-index replaces the rows and moves indexed_at forward", async () => {
    addSession("s1", "saved", 100, ["supply and demand"]);
    await indexSession(db, fakeEmbedder(vectors), "s1", 5000);
    await indexSession(db, fakeEmbedder(vectors), "s1", 6000);
    expect(db.get<{ indexed_at: number }>("SELECT indexed_at FROM sessions WHERE id = 's1'")?.indexed_at).toBe(6000);
  });

  it("writes nothing when the session is marked stale while it is being embedded", async () => {
    addSession("s1", "saved", 100, ["supply and demand"]);
    await indexSession(db, fakeEmbedder(vectors), "s1", 5000);
    const embedder: Embedder = {
      modelVersion: "test-1",
      embed: async (texts) => {
        db.run("UPDATE sessions SET indexed_at = NULL WHERE id = 's1'");
        return texts.map(() => [1, 0, 0]);
      },
    };
    expect(await indexSession(db, embedder, "s1", 6000)).toBe(0);
    expect(db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = 's1'")?.indexed_at).toBeNull();
  });

  it("embeds in batches of 16", async () => {
    const segment = (i: number) => Array.from({ length: 100 }, () => `w${i}`).join(" ");
    addSession("s1", "saved", 100, Array.from({ length: 20 }, (_, i) => segment(i)));
    const sizes: number[] = [];
    const embedder: Embedder = { modelVersion: "test-1", embed: async (texts) => { sizes.push(texts.length); return texts.map(() => [1, 0, 0]); } };
    expect(await indexSession(db, embedder, "s1", 5000)).toBe(20);
    expect(sizes).toEqual([16, 4]);
  });
});

describe("indexer with the person's edits (Next 1)", () => {
  it("indexes the edited text and none from a hidden line", async () => {
    addSession("s1", "saved", 100, ["old words", "side talk"]);
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, hidden, speaker, highlights, updated_at) VALUES ('s1:0', 's1', 0, 'supply and demand', 0, NULL, '[]', 1)");
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, hidden, speaker, highlights, updated_at) VALUES ('s1:1000', 's1', 1000, NULL, 1, NULL, '[]', 1)");
    expect(await indexSession(db, fakeEmbedder(vectors), "s1", 5000)).toBe(1);
    const chunkText = db.all<{ text: string }>("SELECT text FROM chunks WHERE session_id = 's1'").map((row) => row.text).join(" ");
    expect(chunkText).toContain("supply and demand");
    expect(chunkText).not.toContain("side talk");
    expect(chunkText).not.toContain("old words");
  });

  it("a mark written while the embedder runs is seen, so the session is indexed again", async () => {
    addSession("s1", "saved", 100, ["old words"]);
    await indexSession(db, fakeEmbedder(vectors), "s1", 5000);
    db.run("UPDATE sessions SET indexed_at = NULL WHERE id = 's1'");
    const embedder: Embedder = {
      modelVersion: "test-1",
      embed: async (texts) => {
        db.run("INSERT INTO line_marks (id, session_id, t_start, text, hidden, speaker, highlights, updated_at) VALUES ('s1:0', 's1', 0, 'supply and demand', 0, NULL, '[]', 2)");
        return texts.map(() => [1, 0, 0]);
      },
    };
    expect(await indexSession(db, embedder, "s1", 6000)).toBe(0);
    expect(db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = 's1'")?.indexed_at).toBeNull();
    expect(await indexSession(db, fakeEmbedder(vectors), "s1", 7000)).toBe(1);
    expect(db.all<{ text: string }>("SELECT text FROM chunks WHERE session_id = 's1'").map((row) => row.text)).toEqual(["supply and demand"]);
  });
});
