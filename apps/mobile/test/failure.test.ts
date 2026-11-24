import { describe, expect, it } from "vitest";
import { classifyFailure, classifyTaskFailure, failureCopy, keepsKey, type CloudFailure } from "../src/core/cloud/failure.ts";

const api = (status: number, code: string, message: string, shortfall: number | null = null) => ({ kind: "api" as const, status, code, message, shortfall });

describe("classifyFailure", () => {
  it("maps every server answer the tasks give", () => {
    expect(classifyFailure(api(402, "insufficient_credits", "not enough credits", 3))).toEqual({ kind: "out_of_credits", shortfall: 3 });
    expect(classifyFailure(api(403, "forbidden", "no zero-retention route for this task"))).toEqual({ kind: "zero_retention" });
    expect(classifyFailure(api(401, "unauthorized", "device signature required"))).toEqual({ kind: "device" });
    expect(classifyFailure(api(401, "unauthorized", "sign in required"))).toEqual({ kind: "signed_out" });
    expect(classifyFailure(api(409, "conflict", "request already finished"))).toEqual({ kind: "already_finished" });
    expect(classifyFailure(api(409, "conflict", "request in progress"))).toEqual({ kind: "busy" });
    expect(classifyFailure(api(429, "rate_limited", "slow down"))).toEqual({ kind: "busy" });
    expect(classifyFailure(api(500, "internal", "model unavailable"))).toEqual({ kind: "model_failed" });
    expect(classifyFailure(api(200, "internal", "model failed"))).toEqual({ kind: "model_failed" });
    expect(classifyFailure(api(500, "internal", "config unavailable"))).toEqual({ kind: "failed" });
    expect(classifyFailure(api(400, "bad_request", "invalid request"))).toEqual({ kind: "failed" });
    expect(classifyFailure(api(400, "bad_request", "job type not available"))).toEqual({ kind: "not_available" });
    expect(classifyFailure(api(400, "bad_request", "fallback voice not available"))).toEqual({ kind: "failed" });
    expect(classifyFailure({ kind: "network" })).toEqual({ kind: "offline" });
    expect(classifyFailure({ kind: "not_registered" })).toEqual({ kind: "device" });
    expect(classifyFailure({ kind: "bad_reply" })).toEqual({ kind: "failed" });
  });
});

describe("classifyTaskFailure", () => {
  const api = (status: number, message: string) => ({ kind: "api" as const, status, code: "bad_request", message, shortfall: null });
  it("an older server answers 400 to a problem_help quote: not available, whatever the message", () => {
    expect(classifyTaskFailure("problem_help", api(400, "invalid request"))).toEqual({ kind: "not_available" });
    expect(classifyTaskFailure("problem_help", api(400, "job type not available"))).toEqual({ kind: "not_available" });
    expect(classifyTaskFailure("problem_help", api(500, "config unavailable"))).toEqual({ kind: "failed" });
  });
  it("other tasks keep the general mapping", () => {
    expect(classifyTaskFailure("practice", api(400, "invalid request"))).toEqual({ kind: "failed" });
    expect(classifyTaskFailure(undefined, api(400, "invalid request"))).toEqual({ kind: "failed" });
    expect(classifyTaskFailure("problem_help", { kind: "network" })).toEqual({ kind: "offline" });
  });
});

describe("keys and copy", () => {
  const all: CloudFailure[] = [
    { kind: "out_of_credits", shortfall: 1 }, { kind: "zero_retention" }, { kind: "model_failed" }, { kind: "already_finished" },
    { kind: "busy" }, { kind: "offline" }, { kind: "device" }, { kind: "signed_out" }, { kind: "not_available" }, { kind: "failed" },
  ];
  it("only a request that did not run keeps its key", () => {
    expect(all.filter(keepsKey).map((f) => f.kind)).toEqual(["out_of_credits", "busy", "offline", "device", "signed_out"]);
  });
  it("every failure has copy and at least one action", () => {
    for (const f of all) expect(failureCopy(f).actions.length).toBeGreaterThan(0);
    expect(failureCopy({ kind: "out_of_credits", shortfall: 1 }).body).toBe("You need 1 more credit for this. Get credits, then try again.");
    expect(failureCopy({ kind: "model_failed" }).actions).toEqual(["try_again", "ask_later"]);
    expect(failureCopy({ kind: "not_available" })).toEqual({ title: "Not available yet", body: "NotePath's cloud can't do this yet. Nothing was charged.", actions: ["close"] });
  });
});

describe("copy by context", () => {
  it("keeps the Explain copy by default: offline points at Ask later", () => {
    const offline = failureCopy({ kind: "offline" });
    expect(offline).toEqual({
      title: "You're offline",
      body: "Tap Ask later to keep your question. It will wait in Questions for later.",
      actions: ["ask_later", "try_again"],
    });
    expect(failureCopy({ kind: "offline" }, "explain")).toEqual(offline);
  });
  it("the make screens say what to do without Ask later", () => {
    expect(failureCopy({ kind: "offline" }, "make")).toEqual({
      title: "You're offline",
      body: "Connect to the internet to make this.",
      actions: ["try_again"],
    });
    expect(failureCopy({ kind: "model_failed" }, "make")).toEqual({
      title: "Couldn't get an answer",
      body: "Nothing was charged. You can try again.",
      actions: ["try_again"],
    });
  });
  it("only the sign-in failure offers Sign in again, in every context", () => {
    const all: CloudFailure[] = [
      { kind: "out_of_credits", shortfall: 1 }, { kind: "zero_retention" }, { kind: "model_failed" }, { kind: "already_finished" },
      { kind: "busy" }, { kind: "offline" }, { kind: "device" }, { kind: "signed_out" }, { kind: "failed" },
    ];
    for (const context of ["explain", "make"] as const) {
      for (const f of all) expect(failureCopy(f, context).signIn === true).toBe(f.kind === "signed_out");
      expect(failureCopy({ kind: "signed_out" }, context).actions).toEqual(["close"]);
    }
  });
});
