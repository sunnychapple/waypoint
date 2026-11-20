import { expect, test } from "vitest";
import { CreateLinkRequestSchema, LinkDataSchema, LinkIdSchema, LinkPasscodeSchema } from "../src/links.ts";

const GROUP = "group_aaaaaaaaaaaa";
const DATA = "a".repeat(44);

test("LinkIdSchema accepts 22 and 64 characters", () => {
  expect(LinkIdSchema.safeParse("a".repeat(22)).success).toBe(true);
  expect(LinkIdSchema.safeParse("a".repeat(64)).success).toBe(true);
});

test("LinkDataSchema rejects 43 characters and = padding", () => {
  expect(LinkDataSchema.safeParse("a".repeat(43)).success).toBe(false);
  expect(LinkDataSchema.safeParse(`${"a".repeat(43)}=`).success).toBe(false);
});

test("LinkDataSchema takes 5,592,406 characters and refuses 5,592,407 or 20 million without throwing", () => {
  expect(LinkDataSchema.safeParse("a".repeat(5_592_406)).success).toBe(true);
  expect(LinkDataSchema.safeParse("a".repeat(5_592_407)).success).toBe(false);
  expect(LinkDataSchema.safeParse("a".repeat(20_000_000)).success).toBe(false);
  expect(LinkDataSchema.safeParse(`${"a".repeat(5_000_000)}!`).success).toBe(false);
});

test("LinkPasscodeSchema accepts 1234 and a!b~ and rejects 123, 65 characters, a space and non-ASCII", () => {
  expect(LinkPasscodeSchema.safeParse("1234").success).toBe(true);
  expect(LinkPasscodeSchema.safeParse("a!b~").success).toBe(true);
  expect(LinkPasscodeSchema.safeParse("123").success).toBe(false);
  expect(LinkPasscodeSchema.safeParse("a".repeat(65)).success).toBe(false);
  expect(LinkPasscodeSchema.safeParse("12 34").success).toBe(false);
  expect(LinkPasscodeSchema.safeParse("päss").success).toBe(false);
});

test("CreateLinkRequestSchema rejects an extra key and a missing passcode", () => {
  const base = { id: "a".repeat(22), group_id: GROUP, data: DATA, expires_at: null };
  expect(CreateLinkRequestSchema.safeParse({ ...base, passcode: null }).success).toBe(true);
  expect(CreateLinkRequestSchema.safeParse({ ...base, passcode: null, extra: 1 }).success).toBe(false);
  expect(CreateLinkRequestSchema.safeParse(base).success).toBe(false);
});
