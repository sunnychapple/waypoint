import { expect, test } from "vitest";
import { BlobKeySchema, PostChangeRequestSchema, SyncAckMessageSchema, SyncServerMessageSchema } from "../src/sync.ts";

const valid = {
  device_id: "device_aaaaaaaa",
  key_version: 1,
  kind: "note_edit",
  locked_bytes: "a".repeat(44),
  blob_key: null,
};

test("PostChangeRequestSchema accepts a 44-character locked_bytes and rejects 43, a kind of Note, key_version 0 and an extra key", () => {
  expect(PostChangeRequestSchema.safeParse(valid).success).toBe(true);
  expect(PostChangeRequestSchema.safeParse({ ...valid, locked_bytes: "a".repeat(43) }).success).toBe(false);
  expect(PostChangeRequestSchema.safeParse({ ...valid, kind: "Note" }).success).toBe(false);
  expect(PostChangeRequestSchema.safeParse({ ...valid, key_version: 0 }).success).toBe(false);
  expect(PostChangeRequestSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
});

test("BlobKeySchema accepts a media key and rejects results/x, a 15-character group id and ../", () => {
  expect(BlobKeySchema.safeParse("groups/group_aaaaaaaaaaaa/media/blob_bbbbbbbbbbbbbb").success).toBe(true);
  expect(BlobKeySchema.safeParse("results/x").success).toBe(false);
  expect(BlobKeySchema.safeParse("groups/group_aaaaaaaaa/media/blob_bbbbbbbbbbbbbb").success).toBe(false);
  expect(BlobKeySchema.safeParse("groups/../media/blob_bbbbbbbbbbbbbb").success).toBe(false);
});

test("SyncServerMessageSchema parses a changed message and rejects an extra key; SyncAckMessageSchema rejects seq -1", () => {
  expect(SyncServerMessageSchema.safeParse({ type: "changed", last_seq: 3 }).success).toBe(true);
  expect(SyncServerMessageSchema.safeParse({ type: "changed", last_seq: 3, extra: 1 }).success).toBe(false);
  expect(SyncAckMessageSchema.safeParse({ type: "ack", seq: -1 }).success).toBe(false);
});
