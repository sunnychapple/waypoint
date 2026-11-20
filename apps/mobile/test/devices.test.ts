import type { DeviceView, PairingView } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { accountStep, approverStep, deviceRows, newDeviceStep, parseApprover, parseKnown, removalPlan, updateKnown } from "../src/core/device/devices.ts";

const K = (c: string): string => c.repeat(87);
const N = (c: string): string => c.repeat(43);
function row(over: Partial<DeviceView>): DeviceView {
  return { id: "dev_1", kind: "device", name: "iPhone 15", platform: "ios", sign_pub: K("A"), box_pub: K("B"), cert: "C".repeat(86), account_envelope: null, added_at: 1, approved_at: 1, approved_by: null, ...over };
}
const ACCOUNT = row({ id: "acct_1", kind: "account", name: "Account key", platform: "account", cert: null, sign_pub: K("S"), box_pub: K("X") });
const VIEW: PairingView = { device_id: "dev_new", commitment: N("C"), expires_at: 1000, approver: null, approver_nonce: null, device_nonce: null };

describe("known devices", () => {
  it("parseKnown keeps string entries and survives junk", () => {
    expect(parseKnown(null)).toEqual({});
    expect(parseKnown("not json")).toEqual({});
    expect(parseKnown("[1]")).toEqual({});
    expect(parseKnown('{"a":"x","b":2}')).toEqual({ a: "x" });
  });
  it("parseApprover", () => {
    expect(parseApprover('{"id":"dev_a","signPub":"P"}')).toEqual({ id: "dev_a", signPub: "P" });
    expect(parseApprover('{"id":1}')).toBeNull();
    expect(parseApprover(null)).toBeNull();
  });
  it("updateKnown adds approved devices whose certificate verifies, and never drops one", () => {
    const devices = [ACCOUNT, row({ id: "dev_1" }), row({ id: "dev_2", sign_pub: K("D") }), row({ id: "dev_3", approved_at: null }), row({ id: "dev_4", cert: null })];
    const verify = ({ deviceId }: { deviceId: string }) => deviceId !== "dev_2";
    expect(updateKnown({ old: K("O") }, devices, K("S"), verify)).toEqual({ old: K("O"), dev_1: K("A") });
  });
});

describe("accountStep", () => {
  it("nothing to do when this iPhone holds the current account key, or is not approved", () => {
    expect(accountStep([ACCOUNT, row({})], "dev_1", "acct_1")).toEqual({ kind: "none" });
    expect(accountStep([ACCOUNT, row({ approved_at: null })], "dev_1", null)).toEqual({ kind: "none" });
  });
  it("adopt the envelope on our row when the account row changed", () => {
    expect(accountStep([row({ ...ACCOUNT, id: "acct_2" }), row({ account_envelope: "E" })], "dev_1", "acct_1")).toEqual({
      kind: "adopt",
      account: { id: "acct_2", signPub: K("S"), boxPub: K("X") },
      envelope: "E",
    });
  });
  it("missing when approved without an envelope and without the key", () => {
    expect(accountStep([ACCOUNT, row({})], "dev_1", null)).toEqual({ kind: "missing" });
  });
});

describe("devices list and removal", () => {
  const list = [ACCOUNT, row({ id: "dev_b", added_at: 5 }), row({ id: "dev_w", approved_at: null, added_at: 2 }), row({ id: "dev_1", added_at: 9 })];
  it("this iPhone first, then approved, then waiting", () => {
    expect(deviceRows(list, "dev_1").map((r) => r.id)).toEqual(["dev_1", "dev_b", "dev_w"]);
  });
  it("a waiting device is removed plainly; an approved one rotates for every device that stays", () => {
    expect(removalPlan(list, "dev_w")).toEqual({ kind: "plain" });
    expect(removalPlan(list, "dev_b")).toEqual({ kind: "rotate", remaining: [{ id: "dev_1", signPub: K("A"), boxPub: K("B") }] });
    expect(removalPlan([ACCOUNT, row({})], "dev_1")).toEqual({ kind: "plain" });
    expect(removalPlan(list, "acct_1")).toBeNull();
    expect(removalPlan(list, "nope")).toBeNull();
  });
});

describe("pairing steps", () => {
  it("the new iPhone reveals only after the approver's nonce", () => {
    expect(newDeviceStep(VIEW, 0)).toEqual({ kind: "wait_approver" });
    expect(newDeviceStep({ ...VIEW, approver: { id: "dev_a", sign_pub: K("A") }, approver_nonce: N("A") }, 0)).toEqual({
      kind: "reveal",
      approver: { id: "dev_a", signPub: K("A") },
      approverNonce: N("A"),
    });
    expect(newDeviceStep({ ...VIEW, device_nonce: N("D") }, 0)).toEqual({ kind: "wait_approval" });
    expect(newDeviceStep(VIEW, 1000)).toEqual({ kind: "expired" });
  });
  it("the approver starts, waits, then compares; another approver means taken", () => {
    expect(approverStep(VIEW, "dev_a", 0)).toEqual({ kind: "start" });
    const mine = { ...VIEW, approver: { id: "dev_a", sign_pub: K("A") }, approver_nonce: N("A") };
    expect(approverStep(mine, "dev_a", 0)).toEqual({ kind: "wait_reveal" });
    expect(approverStep({ ...mine, device_nonce: N("D") }, "dev_a", 0)).toEqual({ kind: "compare", deviceNonce: N("D") });
    expect(approverStep(mine, "dev_b", 0)).toEqual({ kind: "taken" });
    expect(approverStep(mine, "dev_a", 1000)).toEqual({ kind: "expired" });
  });
});
