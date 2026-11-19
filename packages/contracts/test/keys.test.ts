import { describe, expect, test } from "vitest";
import {
  ApproveDeviceRequestSchema,
  DeviceViewSchema,
  PairingNonceRequestSchema,
  PutRecoveryRequestSchema,
  RegisterDeviceRequestSchema,
} from "../src/keys.ts";
import vectors from "../../crypto/test/vectors/waypoint-v1.json";

const SIGN_PUB = "A".repeat(87);
const BOX_PUB = "B".repeat(87);
const COMMITMENT = "C".repeat(43);
const CERT = "D".repeat(86);

const FIRST_DEVICE = {
  id: "device_1",
  name: "Mina's iPhone",
  platform: "ios",
  sign_pub: SIGN_PUB,
  box_pub: BOX_PUB,
  account: { id: "account_1", sign_pub: SIGN_PUB, box_pub: BOX_PUB, cert: CERT },
};

const NEW_DEVICE = {
  id: "device_2",
  name: "Sam's iPad",
  platform: "ios",
  sign_pub: SIGN_PUB,
  box_pub: BOX_PUB,
  commitment: COMMITMENT,
};

describe("RegisterDeviceRequestSchema", () => {
  test("a first-device body and a new-device body both parse", () => {
    expect(RegisterDeviceRequestSchema.safeParse(FIRST_DEVICE).success).toBe(true);
    expect(RegisterDeviceRequestSchema.safeParse(NEW_DEVICE).success).toBe(true);
  });

  test("a body with both commitment and account fails", () => {
    expect(RegisterDeviceRequestSchema.safeParse({ ...FIRST_DEVICE, commitment: COMMITMENT }).success).toBe(false);
  });

  test("a body with neither commitment nor account fails", () => {
    const { commitment: _unused, ...neither } = NEW_DEVICE;
    expect(RegisterDeviceRequestSchema.safeParse(neither).success).toBe(false);
  });

  test("an sign_pub of 86 characters fails", () => {
    expect(RegisterDeviceRequestSchema.safeParse({ ...NEW_DEVICE, sign_pub: "A".repeat(86) }).success).toBe(false);
  });

  test("platform android fails", () => {
    expect(RegisterDeviceRequestSchema.safeParse({ ...NEW_DEVICE, platform: "android" }).success).toBe(false);
  });

  test("an extra key fails", () => {
    expect(RegisterDeviceRequestSchema.safeParse({ ...NEW_DEVICE, extra: 1 }).success).toBe(false);
  });

  test("DeviceViewSchema accepts a pending row (nulls) and an approved one", () => {
    const pending = {
      id: "device_2",
      kind: "device",
      name: "Sam's iPad",
      platform: "ios",
      sign_pub: SIGN_PUB,
      box_pub: BOX_PUB,
      cert: null,
      account_envelope: null,
      added_at: 1,
      approved_at: null,
      approved_by: null,
    };
    expect(DeviceViewSchema.safeParse(pending).success).toBe(true);
    expect(DeviceViewSchema.safeParse({ ...pending, cert: CERT, approved_at: 2, approved_by: "account_1" }).success).toBe(true);
  });
});

describe("S1C pairing and approval schemas", () => {
  test("PairingNonceRequestSchema takes a 43-character nonce and refuses 42", () => {
    expect(PairingNonceRequestSchema.safeParse({ nonce: "N".repeat(43) }).success).toBe(true);
    expect(PairingNonceRequestSchema.safeParse({ nonce: "N".repeat(42) }).success).toBe(false);
  });

  test("ApproveDeviceRequestSchema refuses 501 envelopes and key_version 0", () => {
    const envelope = { group_id: "g1", key_version: 1, wrapped_key: "E".repeat(10) };
    const base = { cert: CERT, account_envelope: "E".repeat(10) };
    expect(ApproveDeviceRequestSchema.safeParse({ ...base, envelopes: [envelope] }).success).toBe(true);
    expect(ApproveDeviceRequestSchema.safeParse({ ...base, envelopes: Array.from({ length: 501 }, () => envelope) }).success).toBe(false);
    expect(ApproveDeviceRequestSchema.safeParse({ ...base, envelopes: [{ ...envelope, key_version: 0 }] }).success).toBe(false);
  });
});

describe("PutRecoveryRequestSchema", () => {
  // The recovery entry of the published vectors, read from the file so the test follows any change to it.
  const VECTOR_ACCOUNT_DEVICE_ID = vectors.recovery.account_device_id;
  const VECTOR_BLOB = vectors.recovery.blob;

  test("takes the blob of waypoint-v1.json and refuses 123 characters", () => {
    const body = { account_device_id: VECTOR_ACCOUNT_DEVICE_ID, wrapped_account_key: VECTOR_BLOB, verified: true };
    expect(PutRecoveryRequestSchema.safeParse(body).success).toBe(true);
    expect(PutRecoveryRequestSchema.safeParse({ ...body, wrapped_account_key: VECTOR_BLOB.slice(0, 123) }).success).toBe(false);
  });
});
