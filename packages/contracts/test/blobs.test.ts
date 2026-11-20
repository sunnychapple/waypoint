import { expect, test } from "vitest";
import { BlobIdSchema, BlobStoredSchema } from "../src/blobs.ts";

test("BlobIdSchema accepts 16 and 64 characters", () => {
  expect(BlobIdSchema.safeParse("a".repeat(16)).success).toBe(true);
  expect(BlobIdSchema.safeParse("a".repeat(64)).success).toBe(true);
});

test("BlobIdSchema rejects 15 and 65 characters and a slash", () => {
  expect(BlobIdSchema.safeParse("a".repeat(15)).success).toBe(false);
  expect(BlobIdSchema.safeParse("a".repeat(65)).success).toBe(false);
  expect(BlobIdSchema.safeParse("a/b").success).toBe(false);
});

test("BlobStoredSchema rejects bytes: 0", () => {
  expect(BlobStoredSchema.safeParse({ id: "a".repeat(16), group_id: "group_aaaaaaaaaaaa", bytes: 0 }).success).toBe(false);
});
