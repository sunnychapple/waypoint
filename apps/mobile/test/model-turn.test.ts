import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asPerson, personWaiting } from "../src/platform/modelTurn.ts";

describe("asPerson", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries busy, then succeeds", async () => {
    const run = vi.fn().mockRejectedValueOnce({ code: "busy" }).mockResolvedValueOnce("ok");
    const result = asPerson(run);
    await vi.advanceTimersByTimeAsync(400);
    await expect(result).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after the deadline", async () => {
    const run = vi.fn().mockRejectedValue({ code: "busy" });
    const result = asPerson(run).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(result).resolves.toEqual({ code: "busy" });
    expect(run.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not retry other errors", async () => {
    const run = vi.fn().mockRejectedValue({ code: "declined" });
    await expect(asPerson(run)).rejects.toEqual({ code: "declined" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("says a person is waiting only while the request runs", async () => {
    expect(personWaiting()).toBe(false);
    const result = asPerson(() => new Promise((resolve) => setTimeout(() => resolve("done"), 100)));
    expect(personWaiting()).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("done");
    expect(personWaiting()).toBe(false);
  });
});
