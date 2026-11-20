import { describe, expect, it } from "vitest";
import { classifyFailure, failureCopy, keepsKey, type CloudFailure } from "../src/core/cloud/failure.ts";

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
    expect(classifyFailure({ kind: "network" })).toEqual({ kind: "offline" });
    expect(classifyFailure({ kind: "not_registered" })).toEqual({ kind: "device" });
    expect(classifyFailure({ kind: "bad_reply" })).toEqual({ kind: "failed" });
  });
});

describe("keys and copy", () => {
  const all: CloudFailure[] = [
    { kind: "out_of_credits", shortfall: 1 }, { kind: "zero_retention" }, { kind: "model_failed" }, { kind: "already_finished" },
    { kind: "busy" }, { kind: "offline" }, { kind: "device" }, { kind: "signed_out" }, { kind: "failed" },
  ];
  it("only a request that did not run keeps its key", () => {
    expect(all.filter(keepsKey).map((f) => f.kind)).toEqual(["out_of_credits", "busy", "offline", "device", "signed_out"]);
  });
  it("every failure has copy and at least one action", () => {
    for (const f of all) expect(failureCopy(f).actions.length).toBeGreaterThan(0);
    expect(failureCopy({ kind: "out_of_credits", shortfall: 1 }).body).toBe("You need 1 more credit for this. Get credits, then try again.");
    expect(failureCopy({ kind: "model_failed" }).actions).toEqual(["try_again", "ask_later"]);
  });
});
