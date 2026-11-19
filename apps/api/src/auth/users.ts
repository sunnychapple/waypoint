import type { Db } from "../storage.ts";

export type SessionUser = {
  id: string;
  clerk_id: string;
  plan: "free" | "plus" | "own";
  billing_account_id: string;
  zero_retention: boolean;
};

type UserRow = Omit<SessionUser, "zero_retention"> & { zero_retention: number };

export async function loadOrCreateUser(db: Db, clerkId: string, now: number, newId: () => string): Promise<SessionUser> {
  const id = newId();
  await db
    .prepare(
      "INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?) ON CONFLICT (clerk_id) DO NOTHING",
    )
    .bind(id, clerkId, now, id)
    .run();
  const row = await db
    .prepare("SELECT id, clerk_id, plan, billing_account_id, zero_retention FROM users WHERE clerk_id = ?")
    .bind(clerkId)
    .first<UserRow>();
  if (row === null) throw new Error("user row missing after insert");
  return { ...row, zero_retention: row.zero_retention === 1 };
}
