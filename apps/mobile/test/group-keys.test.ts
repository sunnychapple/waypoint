import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { acceptNewAccountKey, changedAccounts, firstSetDelayMs, isTrusted, knownAccounts, noteAccounts, planKeys, versionsFor, type Target } from "../src/core/groups/keys.ts";
import { createMemoryDb } from "./helpers/db.ts";

const K = (c: string) => c.repeat(87);
function t(over: Partial<Target>): Target {
  return { id: "dev_a", user_id: "usr_a", kind: "device", role: "owner", sign_pub: K("A"), box_pub: K("B"), cert: "C".repeat(86), has_current_key: false, ...over };
}
const verify = ({ accountSignPub, cert }: { accountSignPub: string; cert: string }) => cert === "C".repeat(86) && accountSignPub !== K("X");

describe("trust on first use", () => {
  it("first sight is kept, a change is pending until accepted, our own key always wins", () => {
    const db = createMemoryDb();
    migrate(db);
    const me = { userId: "usr_me", accountSignPub: K("M") };
    expect(noteAccounts(db, [t({ kind: "account", user_id: "usr_b", sign_pub: K("S") })], me, 1)).toEqual([]);
    expect(knownAccounts(db)).toEqual({ usr_me: K("M"), usr_b: K("S") });
    expect(noteAccounts(db, [t({ kind: "account", user_id: "usr_b", sign_pub: K("T") })], me, 2)).toEqual(["usr_b"]);
    expect(noteAccounts(db, [t({ kind: "account", user_id: "usr_b", sign_pub: K("T") })], me, 3)).toEqual([]);
    expect(knownAccounts(db).usr_b).toBe(K("S"));
    expect(changedAccounts(db)).toEqual([{ userId: "usr_b", changedAt: 2 }]);
    acceptNewAccountKey(db, "usr_b");
    expect(knownAccounts(db).usr_b).toBe(K("T"));
    expect(changedAccounts(db)).toEqual([]);
    noteAccounts(db, [], { userId: "usr_me", accountSignPub: K("N") }, 4);
    expect(knownAccounts(db).usr_me).toBe(K("N"));
  });
  it("isTrusted: an account row by its key, a device by its certificate", () => {
    const known = { usr_a: K("S") };
    expect(isTrusted(t({ kind: "account", sign_pub: K("S") }), known, verify)).toBe(true);
    expect(isTrusted(t({ kind: "account", sign_pub: K("Q") }), known, verify)).toBe(false);
    expect(isTrusted(t({}), known, verify)).toBe(true);
    expect(isTrusted(t({ cert: null }), known, verify)).toBe(false);
    expect(isTrusted(t({ user_id: "usr_unknown" }), known, verify)).toBe(false);
  });
});

describe("planKeys", () => {
  const known = { usr_a: K("S"), usr_me: K("M") };
  const mine = t({ id: "dev_me", user_id: "usr_me" });
  it("nobody holds the current version: a first set for every target, unless one is untrusted", () => {
    expect(planKeys({ targets: [mine, t({})], me: { userId: "usr_me", role: "editor" }, keyVersion: 2, holdsCurrent: false, known, verify })).toEqual({ kind: "first", recipients: [mine, t({})] });
    const stranger = t({ id: "dev_x", user_id: "usr_x" });
    expect(planKeys({ targets: [mine, stranger], me: { userId: "usr_me", role: "editor" }, keyVersion: 2, holdsCurrent: false, known, verify })).toEqual({ kind: "blocked", untrusted: [stranger] });
  });
  it("adds: an owner serves everyone, others only their own rows", () => {
    const other = t({ id: "dev_new", user_id: "usr_a" });
    const ownNew = t({ id: "dev_me2", user_id: "usr_me" });
    const held = [t({ id: "dev_me", user_id: "usr_me", has_current_key: true }), other, ownNew];
    expect(planKeys({ targets: held, me: { userId: "usr_me", role: "owner" }, keyVersion: 2, holdsCurrent: true, known, verify })).toEqual({ kind: "add", recipients: [other, ownNew] });
    expect(planKeys({ targets: held, me: { userId: "usr_me", role: "editor" }, keyVersion: 2, holdsCurrent: true, known, verify })).toEqual({ kind: "add", recipients: [ownNew] });
    expect(planKeys({ targets: [t({ has_current_key: true })], me: { userId: "usr_me", role: "editor" }, keyVersion: 2, holdsCurrent: false, known, verify })).toEqual({ kind: "none" });
  });
  it("version 1 is never made by anyone but the creator, even when nobody holds it yet", () => {
    expect(planKeys({ targets: [mine, t({})], me: { userId: "usr_me", role: "owner" }, keyVersion: 1, holdsCurrent: false, known, verify })).toEqual({ kind: "none" });
    expect(planKeys({ targets: [mine, t({})], me: { userId: "usr_me", role: "owner" }, keyVersion: 1, holdsCurrent: true, known, verify })).toEqual({ kind: "add", recipients: [mine, t({})] });
  });
  it("versionsFor and the delay", () => {
    const held = [{ keyVersion: 1, learnedAt: 10 }, { keyVersion: 2, learnedAt: 50 }, { keyVersion: 3, learnedAt: 90 }];
    expect(versionsFor(held, 0, 3)).toEqual([1, 2, 3]);
    expect(versionsFor(held, 40, 3)).toEqual([2, 3]);
    expect(versionsFor(held, 100, 3)).toEqual([3]);
    expect(versionsFor([], 0, 1)).toEqual([]);
    expect(firstSetDelayMs(() => 0.5)).toBe(15_000);
    expect(firstSetDelayMs(() => 1)).toBeLessThan(30_000);
  });
});
