import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { indexSession, type Embedder } from "../src/core/search/indexer.ts";
import { clearVectorCache, searchNotes } from "../src/core/search/query.ts";
import { quantize } from "../src/core/search/vectors.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;

beforeEach(() => {
  clearVectorCache();
  db = createMemoryDb();
  migrate(db);
  db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('space-1', 'My notes', 1, 0, 0)");
  db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('space-2', 'Work', 0, 0, 0)");
});

// Embeds each text by exact match; any other text gets an empty vector.
function fakeEmbedder(table: Record<string, number[]>): Embedder {
  return { modelVersion: "test-1", embed: async (texts) => texts.map((text) => table[text] ?? []) };
}

function addSession(id: string, spaceId: string, title: string, segments: string[]): void {
  db.run(
    "INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at, recorded_ms) VALUES (?, ?, 'recording', ?, 'saved', 'done', 100, 0)",
    [id, spaceId, title],
  );
  segments.forEach((text, i) => {
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES (?, ?, ?, ?, 'device')", [id, i * 1000, i * 1000 + 900, text]);
  });
}

describe("searchNotes", () => {
  it("finds a chunk by a keyword the meaning does not match", async () => {
    addSession("econ", "space-1", "Economics", ["deadweight loss explained"]);
    const table = { "deadweight loss explained": [0, 1, 0], deadweight: [0, 0, 1] };
    await indexSession(db, fakeEmbedder(table), "econ", 5000);
    const hits = await searchNotes(db, fakeEmbedder(table), "deadweight", {});
    expect(hits.map((h) => h.sessionTitle)).toEqual(["Economics"]);
  });

  it("finds a chunk by meaning when the words do not match", async () => {
    addSession("shop", "space-1", "Shopping", ["price of goods"]);
    const table = { "price of goods": [1, 0, 0], supply: [1, 0, 0] };
    await indexSession(db, fakeEmbedder(table), "shop", 5000);
    const hits = await searchNotes(db, fakeEmbedder(table), "supply", {});
    expect(hits.map((h) => h.snippet)).toEqual(["price of goods"]);
  });

  it("merges keyword and meaning hits in fused order", async () => {
    addSession("both", "space-1", "Both", ["deadweight loss explained"]);
    addSession("keyword", "space-1", "Keyword", ["deadweight welfare notes"]);
    addSession("meaning", "space-1", "Meaning", ["price of goods"]);
    const table = {
      "deadweight loss explained": [1, 0, 0],
      "deadweight welfare notes": [0, 1, 0],
      "price of goods": [0.6, 0.8, 0],
      deadweight: [1, 0, 0],
    };
    await indexSession(db, fakeEmbedder(table), "both", 5000);
    await indexSession(db, fakeEmbedder(table), "keyword", 5000);
    await indexSession(db, fakeEmbedder(table), "meaning", 5000);
    const hits = await searchNotes(db, fakeEmbedder(table), "deadweight", {});
    expect(hits.map((h) => h.sessionTitle)).toEqual(["Both", "Keyword", "Meaning"]);
  });

  it("only returns notes from the given space", async () => {
    addSession("home", "space-1", "Home", ["deadweight at home"]);
    addSession("work", "space-2", "Work", ["deadweight at work"]);
    const table = { "deadweight at home": [0, 1, 0], "deadweight at work": [0, 1, 0], deadweight: [0, 0, 1] };
    await indexSession(db, fakeEmbedder(table), "home", 5000);
    await indexSession(db, fakeEmbedder(table), "work", 5000);
    const hits = await searchNotes(db, fakeEmbedder(table), "deadweight", { spaceId: "space-2" });
    expect(hits.map((h) => h.spaceName)).toEqual(["Work"]);
  });

  it("returns at most limit hits", async () => {
    addSession("a", "space-1", "A", ["deadweight one"]);
    addSession("b", "space-1", "B", ["deadweight two"]);
    addSession("c", "space-1", "C", ["deadweight three"]);
    const table = { "deadweight one": [0, 1, 0], "deadweight two": [0, 1, 0], "deadweight three": [0, 1, 0], deadweight: [0, 0, 1] };
    for (const id of ["a", "b", "c"]) await indexSession(db, fakeEmbedder(table), id, 5000);
    expect(await searchNotes(db, fakeEmbedder(table), "deadweight", { limit: 2 })).toHaveLength(2);
  });

  it("marks the matched words in the snippet with brackets", async () => {
    addSession("econ", "space-1", "Economics", ["deadweight loss explained"]);
    const table = { "deadweight loss explained": [0, 1, 0], deadweight: [0, 0, 1] };
    await indexSession(db, fakeEmbedder(table), "econ", 5000);
    const hits = await searchNotes(db, fakeEmbedder(table), "deadweight", {});
    expect(hits[0]?.snippet).toContain("[deadweight]");
  });

  it("an empty query returns no hits", async () => {
    addSession("econ", "space-1", "Economics", ["deadweight loss explained"]);
    const table = { "deadweight loss explained": [1, 0, 0] };
    await indexSession(db, fakeEmbedder(table), "econ", 5000);
    expect(await searchNotes(db, fakeEmbedder(table), "", {})).toEqual([]);
  });

  it("a new index run makes its notes findable by meaning straight away", async () => {
    addSession("shop", "space-1", "Shopping", ["price of goods"]);
    const table = { "price of goods": [1, 0, 0], "cheap bread": [1, 0, 0], supply: [1, 0, 0] };
    await indexSession(db, fakeEmbedder(table), "shop", 5000);
    expect(await searchNotes(db, fakeEmbedder(table), "supply", {})).toHaveLength(1);
    addSession("bread", "space-1", "Bread", ["cheap bread"]);
    await indexSession(db, fakeEmbedder(table), "bread", 6000);
    expect(await searchNotes(db, fakeEmbedder(table), "supply", {})).toHaveLength(2);
  });

  it("a meaning match below 0.25 similarity is not a hit", async () => {
    addSession("far", "space-1", "Far", ["cells divide"]);
    const table = { "cells divide": [1, 0, 0], tax: [0.2, 0.98, 0] };
    await indexSession(db, fakeEmbedder(table), "far", 5000);
    expect(await searchNotes(db, fakeEmbedder(table), "tax", {})).toEqual([]);
  });

  it("keyword hits are ranked by bm25, not by insert order", async () => {
    addSession("many", "space-1", "Many", ["photosynthesis photosynthesis photosynthesis"]);
    addSession("once", "space-1", "Once", ["photosynthesis happens in leaves with light and water every day"]);
    await indexSession(db, fakeEmbedder({}), "many", 5000);
    await indexSession(db, fakeEmbedder({}), "once", 5000);
    const hits = await searchNotes(db, fakeEmbedder({}), "photosynthesis", {});
    expect(hits.map((h) => h.sessionId)).toEqual(["many", "once"]);
  });

  it("vectors of another length are skipped instead of failing the search", async () => {
    addSession("old", "space-1", "Old", ["supply curve"]);
    await indexSession(db, fakeEmbedder({ "supply curve": [1, 0] }), "old", 5000);
    const hits = await searchNotes(db, fakeEmbedder({ supply: [1, 0, 0] }), "supply", {});
    expect(hits.map((h) => h.sessionId)).toEqual(["old"]);
  });
});

describe("searchNotes without a usable query vector", () => {
  it("keeps the keyword hits when the embedder throws", async () => {
    addSession("econ", "space-1", "Economics", ["deadweight loss explained"]);
    await indexSession(db, fakeEmbedder({ "deadweight loss explained": [0, 1, 0] }), "econ", 5000);
    const broken: Embedder = { modelVersion: "test-1", embed: () => Promise.reject(new Error("unavailable")) };
    const hits = await searchNotes(db, broken, "deadweight", {});
    expect(hits.map((h) => h.sessionTitle)).toEqual(["Economics"]);
  });

  it("an all-zero query vector gives keyword hits only and does not throw", async () => {
    addSession("econ", "space-1", "Economics", ["deadweight loss explained"]);
    const table = { "deadweight loss explained": [0, 1, 0], deadweight: [0, 0, 0] };
    await indexSession(db, fakeEmbedder(table), "econ", 5000);
    const hits = await searchNotes(db, fakeEmbedder(table), "deadweight", {});
    expect(hits.map((h) => h.sessionTitle)).toEqual(["Economics"]);
  });

  it("a re-index that writes no chunks still clears the vector cache", async () => {
    const table = { "supply and demand": [1, 0, 0], market: [1, 0, 0] };
    addSession("s1", "space-1", "One", ["supply and demand"]);
    await indexSession(db, fakeEmbedder(table), "s1", 5000);
    await searchNotes(db, fakeEmbedder(table), "market", {}); // loads the cache
    db.run("DELETE FROM segments WHERE session_id = 's1'");
    expect(await indexSession(db, fakeEmbedder(table), "s1", 6000)).toBe(0);
    // A vector written without indexSession is only found if the cache was cleared by the empty re-index.
    addSession("s2", "space-1", "Two", []);
    db.run("INSERT INTO chunks (id, session_id, source, capture_id, t_start, t_end, text) VALUES (99, 's2', 'transcript', NULL, 0, 900, 'prices')");
    const v = quantize([1, 0, 0]);
    db.run("INSERT INTO search_index (chunk_id, model_version, dim, scale, vector) VALUES (99, 'test-1', 3, ?, ?)", [v.scale, v.bytes]);
    const hits = await searchNotes(db, fakeEmbedder(table), "market", {});
    expect(hits.map((h) => h.sessionId)).toEqual(["s2"]);
  });
});
