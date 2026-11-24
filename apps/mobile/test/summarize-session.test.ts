import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown as import("../src/core/db/sql.ts").SqlDb,
  generation: 1,
  appState: "active",
  recorder: "idle",
  availability: "available",
  summarize: vi.fn(),
}));

vi.mock("react-native", () => ({ AppState: { get currentState() { return state.appState; } } }));
vi.mock("../modules/waypoint-audio/index.ts", () => ({ getRecorderStatus: () => ({ sessionId: "", state: state.recorder, recordedMs: 0 }) }));
vi.mock("../modules/waypoint-model/index.ts", () => ({
  getAvailability: () => state.availability,
  getContextSize: () => 4096,
  summarize: (text: string) => state.summarize(text),
}));
vi.mock("../src/platform/db.ts", () => ({
  dbGeneration: () => state.generation,
  getDb: () => state.db,
  writeDbIf: (_generation: number, write: (db: unknown) => unknown) => write(state.db),
}));

import { nameRecording, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { getSession } from "../src/core/capture/sessions.ts";
import { getSummary } from "../src/core/capture/summary.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { summarizeSession } from "../src/platform/summary.ts";
import { createMemoryDb } from "./helpers/db.ts";

const startedAt = new Date(2026, 10, 24, 9, 0).getTime();

describe("summarizeSession", () => {
  let ids: number;
  let spaceId: string;
  const deps = { now: () => startedAt, newId: () => `s-${++ids}` };

  beforeEach(() => {
    state.db = createMemoryDb();
    migrate(state.db);
    ids = 0;
    spaceId = ensureDefaultSpace(state.db, deps).id;
    // Each test is a new run of the app, so the "tried" memory starts empty.
    state.generation += 1;
    state.appState = "active";
    state.recorder = "idle";
    state.availability = "available";
    state.summarize.mockReset();
    state.summarize.mockResolvedValue({ title: "Cell parts", summary: "Cells have parts." });
  });

  // A finished recording with two lines, named the way stop names it.
  function savedRecording(lines: string[]): string {
    const session = startRecordingSession(state.db, deps, spaceId, true);
    lines.forEach((text, i) => saveSegment(state.db, session.id, { tStart: i * 1000, tEnd: i * 1000 + 900, text }));
    state.db.run("UPDATE sessions SET state = 'saved', transcript = 'done', ended_at = ? WHERE id = ?", [startedAt + 60_000, session.id]);
    nameRecording(state.db, session.id);
    return session.id;
  }

  it("writes the title and summary the model made, when the model is available and nothing records", async () => {
    const id = savedRecording(["Welcome to biology", "Cells have parts"]);
    await summarizeSession(id, 60_000);
    expect(state.summarize).toHaveBeenCalledOnce();
    expect(getSession(state.db, id)?.title).toBe("Cell parts");
    expect(getSummary(state.db, id)?.summary).toBe("Cells have parts.");
  });

  it("asks nothing when the model is not available, and asks once it is", async () => {
    const id = savedRecording(["Cells have parts"]);
    state.availability = "apple_intelligence_off";
    await summarizeSession(id, 60_000);
    expect(state.summarize).not.toHaveBeenCalled();
    state.availability = "available";
    await summarizeSession(id, 60_000);
    expect(state.summarize).toHaveBeenCalledOnce();
  });

  it("asks nothing while this iPhone is recording, and nothing in the background", async () => {
    const id = savedRecording(["Cells have parts"]);
    state.recorder = "recording";
    await summarizeSession(id, 60_000);
    state.recorder = "idle";
    state.appState = "background";
    await summarizeSession(id, 60_000);
    expect(state.summarize).not.toHaveBeenCalled();
    state.appState = "active";
    await summarizeSession(id, 60_000);
    expect(state.summarize).toHaveBeenCalledOnce();
  });

  it("asks once per session and length, and asks again for a new length", async () => {
    const id = savedRecording(["Cells have parts"]);
    await summarizeSession(id, 60_000);
    await summarizeSession(id, 60_000);
    expect(state.summarize).toHaveBeenCalledTimes(1);
    await summarizeSession(id, 120_000);
    expect(state.summarize).toHaveBeenCalledTimes(2);
  });

  it("leaves the title as it was and does not throw when the model rejects", async () => {
    const id = savedRecording(["Welcome to biology"]);
    state.summarize.mockRejectedValue({ code: "declined" });
    await expect(summarizeSession(id, 60_000)).resolves.toBeUndefined();
    expect(getSession(state.db, id)?.title).not.toBe("Cell parts");
    expect(getSummary(state.db, id)?.summary).toBeNull();
  });

  it("never sends a hidden line to the model", async () => {
    const id = savedRecording(["Cells have parts", "Secret password is blue"]);
    state.db.run("INSERT INTO line_marks (id, session_id, t_start, hidden, updated_at) VALUES ('m1', ?, 1000, 1, 0)", [id]);
    await summarizeSession(id, 60_000);
    const input = String(state.summarize.mock.calls[0]?.[0]);
    expect(input).toContain("Cells have parts");
    expect(input).not.toContain("Secret password");
  });
});
