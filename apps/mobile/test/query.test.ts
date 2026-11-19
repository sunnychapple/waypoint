import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { indexSession, type Embedder } from "../src/core/search/indexer.ts";
import { clearVectorCache, searchNotes } from "../src/core/search/query.ts";
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
});
