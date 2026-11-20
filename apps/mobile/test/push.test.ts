import { describe, expect, it } from "vitest";
import { actionForPush, pushEnvironment, pushSentValue, pushTokenRequest } from "../src/core/push/push.ts";

const TOKEN = "AB".repeat(32);

describe("push", () => {
  it("environment names", () => {
    expect(pushEnvironment("development")).toBe("sandbox");
    expect(pushEnvironment("production")).toBe("production");
    expect(pushEnvironment(null)).toBeNull();
  });
  it("the request lower-cases the token and checks the contract", () => {
    const request = pushTokenRequest("3f2c6a1e-0000-4000-8000-000000000001", TOKEN, "sandbox");
    expect(request).toEqual({ device_id: "3f2c6a1e-0000-4000-8000-000000000001", token: "ab".repeat(32), environment: "sandbox" });
    expect(pushTokenRequest("short", TOKEN, "sandbox")).toBeNull();
    expect(pushTokenRequest("3f2c6a1e-0000-4000-8000-000000000001", "xyz", "sandbox")).toBeNull();
    if (request === null) throw new Error("expected a request");
    expect(pushSentValue(request)).toBe(`3f2c6a1e-0000-4000-8000-000000000001:sandbox:${"ab".repeat(32)}`);
  });
  it("taps", () => {
    expect(actionForPush({ kind: "device_approved", ref: "dev" })).toEqual({ kind: "refresh_device" });
    expect(actionForPush({ kind: "job_ready", ref: "job_1" })).toEqual({ kind: "open_job", jobId: "job_1" });
    expect(actionForPush({})).toEqual({ kind: "none" });
  });
});
