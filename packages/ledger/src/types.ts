// Buckets a grant or refund can go to.
export type WalletBucket = "monthly" | "purchased";

// owed holds the balance a clawback could not take back. Its credits are the signed change to the amount owed.
export type Bucket = WalletBucket | "owed";

export type EntryKind = "grant" | "hold" | "settle" | "release" | "refund" | "clawback" | "reset";

// credits is the signed change to that bucket's balance.
export type LedgerEntry = {
  id: string;
  at: number;
  user_id: string | null;
  kind: EntryKind;
  bucket: Bucket;
  credits: number;
  ref: string;
};

export type Hold = {
  id: string;
  user_id: string;
  task: string;
  credits: number;
  expires_at: number;
  from_monthly: number;
  from_purchased: number;
  // The monthly_period the hold was made in. A later reset makes its monthly part forfeit.
  monthly_period: number;
};

export type CommandResult =
  | { ok: true }
  | { ok: true; charged: number; forfeited_monthly: number }
  | { ok: true; forfeited_monthly: number }
  | { ok: true; released: readonly string[] }
  | { ok: true; removed: number; owed: number }
  | { ok: false; shortfall: number }
  | { ok: false; reason: "unknown_hold" }
  | { ok: false; reason: "hold_closed" }
  | { ok: false; reason: "hold_in_progress" };

export type WalletState = {
  balances: {
    monthly: number;
    purchased: number;
    owed: number;
    monthly_period: number;
    monthly_resets_at: number | null;
  };
  holds: Record<string, Hold>;
  // Maps command id to the type and the successful result it first produced.
  applied: Record<string, { type: Command["type"]; result: CommandResult }>;
};

export type Command =
  | { type: "grant"; id: string; bucket: WalletBucket; credits: number; ref: string; user_id?: string | undefined }
  | {
      type: "hold";
      id: string;
      hold_id: string;
      user_id: string;
      task: string;
      credits: number;
      expires_at: number;
    }
  | { type: "settle"; id: string; hold_id: string; actual: number }
  | { type: "release"; id: string; hold_id: string }
  | { type: "release_expired"; id: string }
  | { type: "refund"; id: string; bucket: WalletBucket; credits: number; ref: string; user_id?: string | undefined }
  | { type: "clawback"; id: string; credits: number; ref: string }
  | { type: "reset"; id: string; credits: number; resets_at: number };
