import { expect, test } from "vitest";
import {
  CreateGroupRequestSchema,
  CreateInviteRequestSchema,
  GroupIdSchema,
  InviteTokenSchema,
  TokenHashSchema,
} from "../src/groups.ts";

test("GroupIdSchema accepts a UUID and a 48-character id, and rejects 15 and 49 characters and a dot", () => {
  expect(GroupIdSchema.safeParse("3f2b8c1e-9d4a-4b7e-8f10-2c5d6e7f8a9b").success).toBe(true);
  expect(GroupIdSchema.safeParse("a".repeat(48)).success).toBe(true);
  expect(GroupIdSchema.safeParse("a".repeat(15)).success).toBe(false);
  expect(GroupIdSchema.safeParse("a".repeat(49)).success).toBe(false);
  expect(GroupIdSchema.safeParse("group.aaaaaaaaaa").success).toBe(false);
});

test("InviteTokenSchema accepts 43 characters and rejects 42 and 44; TokenHashSchema rejects upper-case hex", () => {
  expect(InviteTokenSchema.safeParse("T".repeat(43)).success).toBe(true);
  expect(InviteTokenSchema.safeParse("T".repeat(42)).success).toBe(false);
  expect(InviteTokenSchema.safeParse("T".repeat(44)).success).toBe(false);
  expect(TokenHashSchema.safeParse("a".repeat(64)).success).toBe(true);
  expect(TokenHashSchema.safeParse("A".repeat(64)).success).toBe(false);
});

test("CreateGroupRequestSchema rejects kind team, a name_locked with +, and an extra key", () => {
  const valid = { id: "group_aaaaaaaaaaaa", kind: "shared", name_locked: "bmFtZQ" };
  expect(CreateGroupRequestSchema.safeParse(valid).success).toBe(true);
  expect(CreateGroupRequestSchema.safeParse({ ...valid, kind: "team" }).success).toBe(false);
  expect(CreateGroupRequestSchema.safeParse({ ...valid, name_locked: "bmFt+ZQ" }).success).toBe(false);
  expect(CreateGroupRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
});

test("CreateInviteRequestSchema rejects role admin, a negative history_from, and a missing ends_at", () => {
  const valid = { token_hash: "a".repeat(64), role: "viewer", history_from: 0, ends_at: null };
  expect(CreateInviteRequestSchema.safeParse(valid).success).toBe(true);
  expect(CreateInviteRequestSchema.safeParse({ ...valid, role: "admin" }).success).toBe(false);
  expect(CreateInviteRequestSchema.safeParse({ ...valid, history_from: -1 }).success).toBe(false);
  const { ends_at: _omitted, ...withoutEndsAt } = valid;
  expect(CreateInviteRequestSchema.safeParse(withoutEndsAt).success).toBe(false);
});
