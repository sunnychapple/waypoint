import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import {
  beingMadeItems,
  listFinished,
  listWorkingJobs,
  readyItems,
  viewerRoute,
  READY_LIMIT,
  type FinishedRow,
  type WorkingJobRow,
} from "../src/core/made/list.ts";
import { createMemoryDb } from "./helpers/db.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const ALL_ON = { miniApps: true, diagrams: true };
const ALL_OFF = { miniApps: false, diagrams: false };

function job(id: string, type: string, createdAt: number, sessionTitle: string | null = "Cells"): WorkingJobRow {
  return { id, type, sessionTitle, createdAt };
}

function thing(id: string, kind: FinishedRow["kind"], createdAt: number): FinishedRow {
  return { id, kind, title: `Title ${id}`, sessionId: null, createdAt };
}

describe("being made", () => {
  it("lists working jobs newest first, with their kind and session title", () => {
    const items = beingMadeItems([job("a", "research", 1), job("b", "overview_script", 3, null), job("c", "video_slides", 2)], ALL_ON);
    expect(items.map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(items[0]).toEqual({ id: "b", kind: "audio", sessionTitle: null, createdAt: 3 });
    expect(items[1]?.kind).toBe("video");
  });

  it("leaves out second transcripts, which are not made things", () => {
    expect(beingMadeItems([job("r", "retranscribe", 5)], ALL_ON)).toEqual([]);
  });

  it("hides mini apps and diagrams while their flags are off", () => {
    const rows = [job("m", "mini_app", 1), job("d", "diagram", 2), job("p", "practice", 3)];
    expect(beingMadeItems(rows, ALL_OFF).map((i) => i.id)).toEqual(["p"]);
    expect(beingMadeItems(rows, { miniApps: true, diagrams: false }).map((i) => i.id)).toEqual(["p", "m"]);
  });
});

describe("ready", () => {
  it("keeps the last 14 days only, newest first", () => {
    const old = NOW - 15 * DAY;
    const edge = NOW - 14 * DAY;
    const items = readyItems([thing("old", "audio", old), thing("new", "research", NOW - DAY), thing("edge", "practice", edge)], NOW, ALL_ON);
    expect(items.map((i) => i.id)).toEqual(["new", "edge"]);
  });

  it("shows at most 8", () => {
    const rows = Array.from({ length: 12 }, (_, i) => thing(`t${i}`, "research", NOW - i * 1000));
    const items = readyItems(rows, NOW, ALL_ON);
    expect(items).toHaveLength(READY_LIMIT);
    expect(items[0]?.id).toBe("t0");
    expect(items[7]?.id).toBe("t7");
  });

  it("applies the same flags as the session's made list", () => {
    const rows = [thing("m", "mini_app", NOW - 1), thing("d", "diagram", NOW - 2), thing("v", "video", NOW - 3)];
    expect(readyItems(rows, NOW, ALL_OFF).map((i) => i.id)).toEqual(["v"]);
  });
});

describe("viewer routes", () => {
  it("opens each kind on its own viewer, the same routes the session's made list uses", () => {
    expect(viewerRoute("audio", "a/1")).toBe("/overview/a%2F1");
    expect(viewerRoute("video", "v")).toBe("/video/v");
    expect(viewerRoute("practice", "p")).toBe("/practice/p");
    expect(viewerRoute("research", "r")).toBe("/research/r");
    expect(viewerRoute("diagram", "d")).toBe("/diagram/d");
    expect(viewerRoute("mini_app", "m")).toBe("/mini-app/m");
  });
});

describe("queries", () => {
  function setup() {
    const db = createMemoryDb();
    migrate(db);
    const space = ensureDefaultSpace(db, { now: () => 1, newId: () => "unused" });
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('s1', ?, 'pages', 'Cells', 'saved', 1)", [space.id]);
    return db;
  }
  function addJob(db: ReturnType<typeof createMemoryDb>, id: string, type: string, state: string, deleted: boolean = false) {
    db.run(
      "INSERT INTO jobs (id, type, session_id, request_key, state, quoted, created_at, updated_at, deleted_at) VALUES (?, ?, 's1', ?, ?, 5, 10, 10, ?)",
      [id, type, `k_${id}`, state, deleted ? 20 : null],
    );
  }

  it("finds jobs still working, with the session title, and skips finished, deleted and second transcripts", () => {
    const db = setup();
    addJob(db, "q", "research", "queued");
    addJob(db, "r", "overview_script", "running");
    addJob(db, "done", "practice", "succeeded");
    addJob(db, "gone", "diagram", "running", true);
    addJob(db, "second", "retranscribe", "running");
    const rows = listWorkingJobs(db);
    expect(rows.map((r) => r.id).sort()).toEqual(["q", "r"]);
    expect(rows.find((r) => r.id === "q")?.sessionTitle).toBe("Cells");
  });

  it("finds finished things from the last 14 days; overviews only once ready", () => {
    const db = setup();
    const recent = NOW - DAY;
    const old = NOW - 20 * DAY;
    db.run("INSERT INTO made (id, session_id, kind, title, body, created_at) VALUES ('m1', 's1', 'practice', 'Quiz', '{}', ?)", [recent]);
    db.run("INSERT INTO made (id, session_id, kind, title, body, created_at) VALUES ('m2', 's1', 'diagram', 'Old', '{}', ?)", [old]);
    db.run("INSERT INTO overviews (id, session_id, kind, title, script, state, created_at) VALUES ('o1', 's1', 'audio', 'Talk', '{}', 'ready', ?)", [recent]);
    db.run("INSERT INTO overviews (id, session_id, kind, title, script, state, created_at) VALUES ('o2', 's1', 'video', 'Slides', '{}', 'rendering', ?)", [recent]);
    db.run("INSERT INTO research (id, session_id, question, depth, answer, created_at) VALUES ('r1', 's1', 'Why?', 'quick', 'Because', ?)", [recent]);
    const rows = listFinished(db, NOW);
    expect(rows.map((r) => r.id).sort()).toEqual(["m1", "o1", "r1"]);
    expect(rows.find((r) => r.id === "r1")).toMatchObject({ kind: "research", title: "Why?" });
    expect(rows.find((r) => r.id === "o1")).toMatchObject({ kind: "audio", title: "Talk" });
  });
});
