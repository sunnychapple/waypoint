import { describe, expect, test } from "vitest";
import { loadOrCreateUser } from "../src/auth/users.ts";
import { createTestDb } from "./helpers/d1.ts";

const NOW = 1_800_000_000_000;

describe("loadOrCreateUser", () => {
  test("creates a user with billing_account_id equal to its id, plan free and zero_retention false", async () => {
    const db = createTestDb();
    const user = await loadOrCreateUser(db, "user_123", NOW, () => "u1");
    expect(user).toEqual({
      id: "u1",
      clerk_id: "user_123",
      plan: "free",
      billing_account_id: "u1",
      zero_retention: false,
    });
  });

  test("a second call returns the same user and adds no row", async () => {
    const db = createTestDb();
    const first = await loadOrCreateUser(db, "user_123", NOW, () => "u1");
    const second = await loadOrCreateUser(db, "user_123", NOW + 1000, () => "u2");
    expect(second).toEqual(first);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(count).toEqual({ n: 1 });
  });

  test("two calls in a row with different newId values keep the first id", async () => {
    const db = createTestDb();
    await loadOrCreateUser(db, "user_123", NOW, () => "first-id");
    const again = await loadOrCreateUser(db, "user_123", NOW, () => "second-id");
    expect(again.id).toBe("first-id");
    expect(again.billing_account_id).toBe("first-id");
  });

  test("two calls at once with different newId values give one row and the same user", async () => {
    const db = createTestDb();
    const [first, second] = await Promise.all([
      loadOrCreateUser(db, "user_123", NOW, () => "first-id"),
      loadOrCreateUser(db, "user_123", NOW, () => "second-id"),
    ]);
    expect(second).toEqual(first);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(count).toEqual({ n: 1 });
  });

  test("a different Clerk user gets a different row", async () => {
    const db = createTestDb();
    await loadOrCreateUser(db, "user_a", NOW, () => "ua");
    const other = await loadOrCreateUser(db, "user_b", NOW, () => "ub");
    expect(other.id).toBe("ub");
  });

  test("zero_retention comes back as a boolean", async () => {
    const db = createTestDb();
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id, zero_retention) VALUES (?, ?, ?, ?, ?)")
      .bind("u1", "user_123", NOW, "u1", true)
      .run();
    const user = await loadOrCreateUser(db, "user_123", NOW, () => "u2");
    expect(user.zero_retention).toBe(true);
  });
});
