import type { DeviceView } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { deviceName, planRegistration, statusKey, userIdKey } from "../src/core/device/registration.ts";

const KEY_A = "A".repeat(87);
const KEY_B = "B".repeat(87);

function row(over: Partial<DeviceView>): DeviceView {
  return { id: "dev_1", kind: "device", name: "iPhone", platform: "ios", sign_pub: KEY_A, box_pub: KEY_B, cert: null, account_envelope: null, added_at: 1, approved_at: 1, approved_by: null, ...over };
}
const ACCOUNT = row({ id: "acct_1", kind: "account", name: "Account key", platform: "account" });
const LOCAL = { deviceId: "dev_1", signPub: KEY_A, boxPub: KEY_B };

describe("planRegistration", () => {
  it("an empty account makes this iPhone the first device, with or without local keys", () => {
    expect(planRegistration([], null)).toEqual({ kind: "register_first" });
    expect(planRegistration([], LOCAL)).toEqual({ kind: "register_first" });
  });
  it("our approved row is approved; our row without approved_at is waiting", () => {
    expect(planRegistration([ACCOUNT, row({})], LOCAL)).toEqual({ kind: "approved", deviceId: "dev_1" });
    expect(planRegistration([ACCOUNT, row({ approved_at: null })], LOCAL)).toEqual({ kind: "waiting", deviceId: "dev_1" });
  });
  it("an account with another device: register as waiting, or start over when our keys are unknown", () => {
    const other = row({ id: "dev_other" });
    expect(planRegistration([ACCOUNT, other], null)).toEqual({ kind: "register_waiting" });
    expect(planRegistration([ACCOUNT, other], LOCAL)).toEqual({ kind: "start_over" });
  });
  it("a row with our id but other keys means start over", () => {
    expect(planRegistration([ACCOUNT, row({ sign_pub: KEY_B })], LOCAL)).toEqual({ kind: "start_over" });
  });
  it("the account row itself never counts as our device", () => {
    expect(planRegistration([row({ id: "dev_1", kind: "account" })], LOCAL)).toEqual({ kind: "start_over" });
  });
});

describe("names and keys", () => {
  it("deviceName", () => {
    expect(deviceName("iPhone 16 Pro")).toBe("iPhone 16 Pro");
    expect(deviceName(null)).toBe("iPhone");
    expect(deviceName("  ")).toBe("iPhone");
    expect(deviceName("x".repeat(80))).toHaveLength(64);
  });
  it("settings keys", () => {
    expect(userIdKey("user_2abc")).toBe("server_user_id:user_2abc");
    expect(statusKey("u1")).toBe("device_status:u1");
  });
});
