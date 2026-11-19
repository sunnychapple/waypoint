import {
  apply as applyCommand,
  type Command,
  type CommandResult,
  type Hold,
  type LedgerEntry,
  type WalletState,
} from "@waypoint/ledger";
import type { SqlStore } from "../storage.ts";

export type WalletView = {
  monthly: number;
  purchased: number;
  owed: number;
  monthly_resets_at: number | null;
  holds: Hold[];
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS balances (
    bucket TEXT PRIMARY KEY CHECK (bucket IN ('monthly', 'purchased', 'owed')),
    credits INTEGER NOT NULL,
    resets_at INTEGER,
    period INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS holds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    task TEXT NOT NULL,
    credits INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    from_monthly INTEGER NOT NULL,
    from_purchased INTEGER NOT NULL,
    monthly_period INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ledger (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    at INTEGER NOT NULL,
    user_id TEXT,
    kind TEXT NOT NULL,
    bucket TEXT NOT NULL,
    credits INTEGER NOT NULL,
    ref TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS applied (
    command_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    result TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
];

export function createWalletStore(store: SqlStore) {
  store.transactionSync(() => {
    for (const statement of SCHEMA) {
      store.sql.exec(statement);
    }
    store.sql.exec(
      "INSERT OR IGNORE INTO balances (bucket, credits, resets_at, period) VALUES ('monthly', 0, NULL, 0), ('purchased', 0, NULL, 0), ('owed', 0, NULL, 0)",
    );
  });

  // Reads the balances and holds, and the applied row for commandId when one is given.
  function loadState(commandId?: string): WalletState {
    const balances: WalletState["balances"] = {
      monthly: 0,
      purchased: 0,
      owed: 0,
      monthly_period: 0,
      monthly_resets_at: null,
    };
    const balanceRows = store.sql
      .exec("SELECT bucket, credits, resets_at, period FROM balances")
      .toArray() as { bucket: string; credits: number; resets_at: number | null; period: number }[];
    for (const row of balanceRows) {
      if (row.bucket === "monthly") {
        balances.monthly = row.credits;
        balances.monthly_period = row.period;
        balances.monthly_resets_at = row.resets_at;
      } else if (row.bucket === "purchased") {
        balances.purchased = row.credits;
      } else {
        balances.owed = row.credits;
      }
    }

    const holds: Record<string, Hold> = {};
    for (const hold of store.sql.exec("SELECT * FROM holds").toArray() as Hold[]) {
      holds[hold.id] = hold;
    }

    const applied: WalletState["applied"] = {};
    if (commandId !== undefined) {
      const [row] = store.sql
        .exec("SELECT type, result FROM applied WHERE command_id = ?", commandId)
        .toArray() as { type: Command["type"]; result: string }[];
      if (row !== undefined) {
        applied[commandId] = { type: row.type, result: JSON.parse(row.result) as CommandResult };
      }
    }

    return { balances, holds, applied };
  }

  return {
    apply(command: Command, now: number): CommandResult {
      return store.transactionSync(() => {
        const before = loadState(command.id);
        const replay = Object.hasOwn(before.applied, command.id);
        const output = applyCommand(before, command, now);
        if (replay) {
          return output.result;
        }

        const { balances } = output.state;
        store.sql.exec(
          "UPDATE balances SET credits = ?, resets_at = ?, period = ? WHERE bucket = 'monthly'",
          balances.monthly,
          balances.monthly_resets_at,
          balances.monthly_period,
        );
        store.sql.exec("UPDATE balances SET credits = ? WHERE bucket = 'purchased'", balances.purchased);
        store.sql.exec("UPDATE balances SET credits = ? WHERE bucket = 'owed'", balances.owed);

        for (const id of Object.keys(before.holds)) {
          if (!Object.hasOwn(output.state.holds, id)) {
            store.sql.exec("DELETE FROM holds WHERE id = ?", id);
          }
        }
        for (const hold of Object.values(output.state.holds)) {
          if (!Object.hasOwn(before.holds, hold.id)) {
            store.sql.exec(
              "INSERT INTO holds (id, user_id, task, credits, expires_at, from_monthly, from_purchased, monthly_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              hold.id,
              hold.user_id,
              hold.task,
              hold.credits,
              hold.expires_at,
              hold.from_monthly,
              hold.from_purchased,
              hold.monthly_period,
            );
          }
        }

        const [head] = store.sql.exec("SELECT COALESCE(MAX(seq), 0) AS top FROM ledger").toArray() as {
          top: number;
        }[];
        let seq = head?.top ?? 0;
        for (const entry of output.entries) {
          seq += 1;
          store.sql.exec(
            "INSERT INTO ledger (seq, id, at, user_id, kind, bucket, credits, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            seq,
            entry.id,
            entry.at,
            entry.user_id,
            entry.kind,
            entry.bucket,
            entry.credits,
            entry.ref,
          );
        }

        if (output.result.ok) {
          store.sql.exec(
            "INSERT INTO applied (command_id, type, result, at) VALUES (?, ?, ?, ?)",
            command.id,
            command.type,
            JSON.stringify(output.result),
            now,
          );
        }
        return output.result;
      });
    },

    read(): WalletView {
      const { balances, holds } = loadState();
      return {
        monthly: balances.monthly,
        purchased: balances.purchased,
        owed: balances.owed,
        monthly_resets_at: balances.monthly_resets_at,
        holds: Object.values(holds).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      };
    },

    ledger(after: number, limit: number): { entries: LedgerEntry[]; next: number } {
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new RangeError("after must be a non-negative safe integer");
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new RangeError("limit must be an integer from 1 to 500");
      }
      const rows = store.sql
        .exec(
          "SELECT seq, id, at, user_id, kind, bucket, credits, ref FROM ledger WHERE seq > ? ORDER BY seq LIMIT ?",
          after,
          limit,
        )
        .toArray() as (LedgerEntry & { seq: number })[];
      const entries: LedgerEntry[] = rows.map((row) => ({
        id: row.id,
        at: row.at,
        user_id: row.user_id,
        kind: row.kind,
        bucket: row.bucket,
        credits: row.credits,
        ref: row.ref,
      }));
      return { entries, next: rows.at(-1)?.seq ?? after };
    },

    nextExpiry(): number | null {
      const [row] = store.sql.exec("SELECT MIN(expires_at) AS next FROM holds").toArray() as {
        next: number | null;
      }[];
      return row?.next ?? null;
    },
  };
}
