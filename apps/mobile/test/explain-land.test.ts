import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { addToThread, discardIfUnsaved, getExplanation, landedExplanation, saveExplanationNow, startExplanation, type ThreadItem } from "../src/core/explain/explanations.ts";
import { landAnswer } from "../src/core/explain/land.ts";
import { askLater } from "../src/core/explain/later.ts";
import { getSent, logSent } from "../src/core/explain/sent.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1_000, newId: () => `id_${++n}` };
  const space = ensureDefaultSpace(db, deps);
  db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('s1', ?, 'recording', 'Bio', 'saved', 0)", [space.id]);
  return { db, deps };
}

// Logs the request the way useExplain does before sending it, so settleSent has a row to settle.
function sendLogged(db: ReturnType<typeof setup>["db"], key: string, task: "explain" | "more_detail"): void {
  logSent(db, { id: key, task, sessionId: "s1", body: { word: "cell", transcript: "" }, at: 1 });
}

function item(kind: ThreadItem["kind"], sentId: string, text = "answer"): ThreadItem {
  return { kind, text, at: 1, retention: "standard", sentId };
}

describe("a question or answer from a closed sheet", () => {
  it("askLater does not add the same open question twice", () => {
    const { db, deps } = setup();
    askLater(db, deps, "s1", 5, "cell", null);
    askLater(db, deps, "s1", 5, "cell", null);
    askLater(db, deps, "s1", 9, "cell", null);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM flags")?.n).toBe(2);
    db.run("UPDATE flags SET state = 'dismissed' WHERE t = 5");
    askLater(db, deps, "s1", 5, "cell", null);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM flags")?.n).toBe(3);
  });

  it("landedExplanation finds only a saved answer at this place, since the request began", () => {
    const { db, deps } = setup();
    const made = startExplanation(db, deps, "s1", 5, "cell", null);
    const where = { sessionId: "s1", t: 5, term: "cell", captureId: null, since: 1_000 };
    addToThread(db, made.id, item("explain", "k1"));
    expect(landedExplanation(db, where)).toBeNull();
    saveExplanationNow(db, deps, made.id);
    expect(landedExplanation(db, where)?.id).toBe(made.id);
    expect(landedExplanation(db, { ...where, since: 1_001 })).toBeNull();
    expect(landedExplanation(db, { ...where, t: 6 })).toBeNull();
    expect(landedExplanation(db, { ...where, term: "cells" })).toBeNull();
  });
});

describe("landAnswer", () => {
  it("an explain with the sheet closed creates, saves, and marks the flag answered", () => {
    const { db, deps } = setup();
    askLater(db, deps, "s1", 5, "cell", null);
    const flagId = db.get<{ id: string }>("SELECT id FROM flags")?.id;
    sendLogged(db, "k1", "explain");

    const result = landAnswer(db, deps, {
      item: item("explain", "k1"),
      credits: 1,
      retention: "standard",
      existingId: null,
      closed: true,
      sameNotes: true,
      sessionId: "s1",
      t: 5,
      word: "cell",
      captureId: undefined,
      flagId,
    });

    expect(result).not.toBeNull();
    expect(result?.saved).toBe(true);
    const saved = getExplanation(db, result?.id ?? "");
    expect(saved?.saved).toBe(true);
    expect(saved?.thread.map((i) => i.sentId)).toEqual(["k1"]);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM terms")?.n).toBe(1);
    expect(db.get<{ state: string }>("SELECT state FROM flags WHERE id = ?", [flagId ?? ""])?.state).toBe("answered");
    expect(getSent(db, "k1")?.credits).toBe(1);
  });

  it("an explain with no flag saves", () => {
    const { db, deps } = setup();
    sendLogged(db, "k1", "explain");

    const result = landAnswer(db, deps, {
      item: item("explain", "k1"),
      credits: 1,
      retention: "standard",
      existingId: null,
      closed: false,
      sameNotes: true,
      sessionId: "s1",
      t: 5,
      word: "cell",
    });

    expect(result?.saved).toBe(true);
    expect(getExplanation(db, result?.id ?? "")?.saved).toBe(true);
  });

  it("a follow-up on a saved explanation is added and stays saved", () => {
    const { db, deps } = setup();
    sendLogged(db, "k1", "explain");
    const first = landAnswer(db, deps, {
      item: item("explain", "k1"),
      credits: 1,
      retention: "standard",
      existingId: null,
      closed: false,
      sameNotes: true,
      sessionId: "s1",
      t: 5,
      word: "cell",
    });
    const id = first?.id ?? "";
    sendLogged(db, "k2", "more_detail");

    const result = landAnswer(db, deps, {
      item: item("more_detail", "k2", "more"),
      credits: 3,
      retention: "standard",
      existingId: id,
      closed: false,
      sameNotes: true,
      sessionId: "s1",
      t: 5,
      word: "cell",
    });

    expect(result?.thread.map((i) => i.kind)).toEqual(["explain", "more_detail"]);
    expect(result?.saved).toBe(true);
    expect(getExplanation(db, id)?.saved).toBe(true);
    expect(getSent(db, "k2")?.credits).toBe(3);
  });

  it("a follow-up after the person removed the answer adds nothing, does not recreate it, and still settles the credits", () => {
    const { db, deps } = setup();
    const gone = startExplanation(db, deps, "s1", 5, "cell", null);
    discardIfUnsaved(db, gone.id);
    sendLogged(db, "k2", "more_detail");

    const result = landAnswer(db, deps, {
      item: item("more_detail", "k2", "more"),
      credits: 3,
      retention: "standard",
      existingId: gone.id,
      closed: true,
      sameNotes: true,
      sessionId: "s1",
      t: 5,
      word: "cell",
    });

    expect(result).toBeNull();
    expect(getExplanation(db, gone.id)).toBeNull();
    expect(getSent(db, "k2")?.credits).toBe(3);
  });

  it("sameNotes false writes nothing at all, including no settle", () => {
    const { db, deps } = setup();
    sendLogged(db, "k3", "explain");
    const before = db.get<{ n: number }>("SELECT count(*) AS n FROM explanations")?.n;

    const result = landAnswer(db, deps, {
      item: item("explain", "k3"),
      credits: 1,
      retention: "standard",
      existingId: null,
      closed: false,
      sameNotes: false,
      sessionId: "s1",
      t: 5,
      word: "cell",
    });

    expect(result).toBeNull();
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM explanations")?.n).toBe(before);
    expect(getSent(db, "k3")?.credits).toBeNull();
  });

  it("a failing transaction leaves the settle committed", () => {
    const { db, deps } = setup();
    sendLogged(db, "k1", "explain");
    const broken = { ...db, transaction: () => { throw new Error("disk full"); } };

    expect(() =>
      landAnswer(broken, deps, {
        item: item("explain", "k1"),
        credits: 1,
        retention: "standard",
        existingId: null,
        closed: true,
        sameNotes: true,
        sessionId: "s1",
        t: 5,
        word: "cell",
      }),
    ).toThrow("disk full");
    expect(getSent(db, "k1")?.credits).toBe(1);
  });
});
