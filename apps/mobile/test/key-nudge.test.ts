import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createKeyNudger } from "../src/platform/keyNudge.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// A run that finishes when the test resolves it.
function gatedRun() {
  const calls: string[] = [];
  const finishers: (() => void)[] = [];
  const run = (groupId: string) =>
    new Promise<void>((resolve) => {
      calls.push(groupId);
      finishers.push(resolve);
    });
  return { calls, finish: () => finishers.shift()?.(), run };
}

describe("createKeyNudger", () => {
  test("a burst of messages for one group runs the key step once", async () => {
    const calls: string[] = [];
    const nudger = createKeyNudger(async (groupId) => {
      calls.push(groupId);
    }, 1000);
    for (let i = 0; i < 5; i++) {
      nudger.nudge("group_a");
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(["group_a"]);
  });

  test("a message that arrives while the step is running makes exactly one more run, after it", async () => {
    const gate = gatedRun();
    const nudger = createKeyNudger(gate.run, 1000);
    nudger.nudge("group_a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(gate.calls).toEqual(["group_a"]);
    nudger.nudge("group_a");
    nudger.nudge("group_a");
    await vi.advanceTimersByTimeAsync(5000);
    expect(gate.calls).toEqual(["group_a"]); // no second run while the first is going
    gate.finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(gate.calls).toEqual(["group_a", "group_a"]);
    gate.finish();
    await vi.advanceTimersByTimeAsync(5000);
    expect(gate.calls).toEqual(["group_a", "group_a"]);
  });

  test("groups are independent, and a failed run does not stop the next one", async () => {
    const calls: string[] = [];
    let fail = true;
    const nudger = createKeyNudger(async (groupId) => {
      calls.push(groupId);
      if (fail) throw new Error("offline");
    }, 1000);
    nudger.nudge("group_a");
    nudger.nudge("group_b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.sort()).toEqual(["group_a", "group_b"]);
    fail = false;
    nudger.nudge("group_a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(["group_a", "group_b", "group_a"]);
  });
});
