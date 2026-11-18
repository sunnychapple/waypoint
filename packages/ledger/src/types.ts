export type Bucket = "monthly" | "purchased";

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
};

export type CommandResult =
  | { ok: true }
  | { ok: true; charged: number }
  | { ok: true; released: string[] }
  | { ok: true; removed: number }
  | { ok: false; shortfall: number }
  | { ok: false; reason: "unknown_hold" };

export type WalletState = {
  balances: { monthly: number; purchased: number; monthly_resets_at: number | null };
  holds: Record<string, Hold>;
  // Maps command id to the first result it produced.
  applied: Record<string, CommandResult>;
};

export type Command =
  | { type: "grant"; id: string; bucket: Bucket; credits: number; ref: string; user_id?: string }
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
  | { type: "refund"; id: string; bucket: Bucket; credits: number; ref: string; user_id?: string }
  | { type: "clawback"; id: string; credits: number; ref: string }
  | { type: "reset"; id: string; credits: number; resets_at: number };
