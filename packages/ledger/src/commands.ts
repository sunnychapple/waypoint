import type {
  Bucket,
  Command,
  CommandResult,
  EntryKind,
  Hold,
  LedgerEntry,
  WalletState,
} from "./types.ts";

export type ApplyOutput = {
  state: WalletState;
  entries: LedgerEntry[];
  result: CommandResult;
};

type Draft = {
  balances: WalletState["balances"];
  holds: Record<string, Hold>;
  entries: LedgerEntry[];
  command: string;
  at: number;
};

// Applies one command and returns new objects. The input state is never mutated.
export function apply(state: WalletState, command: Command, now: number): ApplyOutput {
  if (Object.hasOwn(state.applied, command.id)) {
    const prior = state.applied[command.id];
    if (prior !== undefined) {
      return { state, entries: [], result: prior };
    }
  }

  const draft: Draft = {
    balances: { ...state.balances },
    holds: { ...state.holds },
    entries: [],
    command: command.id,
    at: now,
  };
  const result = execute(draft, command);

  return {
    state: {
      balances: draft.balances,
      holds: draft.holds,
      applied: { ...state.applied, [command.id]: result },
    },
    entries: draft.entries,
    result,
  };
}

function execute(d: Draft, command: Command): CommandResult {
  switch (command.type) {
    case "grant": {
      requirePositive("credits", command.credits);
      move(d, command.bucket, command.credits, "grant", command.user_id ?? null, command.ref);
      return { ok: true };
    }

    case "hold": {
      requirePositive("credits", command.credits);
      if (Object.hasOwn(d.holds, command.hold_id)) {
        throw new Error(`hold already exists: ${command.hold_id}`);
      }
      const available = d.balances.monthly + d.balances.purchased;
      if (available < command.credits) {
        return { ok: false, shortfall: command.credits - available };
      }
      const fromMonthly = Math.min(d.balances.monthly, command.credits);
      const fromPurchased = command.credits - fromMonthly;
      d.holds[command.hold_id] = {
        id: command.hold_id,
        user_id: command.user_id,
        task: command.task,
        credits: command.credits,
        expires_at: command.expires_at,
        from_monthly: fromMonthly,
        from_purchased: fromPurchased,
      };
      move(d, "monthly", -fromMonthly, "hold", command.user_id, command.hold_id);
      move(d, "purchased", -fromPurchased, "hold", command.user_id, command.hold_id);
      return { ok: true };
    }

    case "settle": {
      requireNonNegative("actual", command.actual);
      const hold = findHold(d, command.hold_id);
      if (!hold) return { ok: false, reason: "unknown_hold" };
      const charged = Math.min(command.actual, hold.credits);
      const rest = hold.credits - charged;
      const toPurchased = Math.min(rest, hold.from_purchased);
      const toMonthly = rest - toPurchased;
      returnToBuckets(d, hold, "settle", toPurchased, toMonthly);
      return { ok: true, charged };
    }

    case "release": {
      const hold = findHold(d, command.hold_id);
      if (!hold) return { ok: false, reason: "unknown_hold" };
      returnToBuckets(d, hold, "release", hold.from_purchased, hold.from_monthly);
      return { ok: true };
    }

    case "release_expired": {
      const due = Object.values(d.holds)
        .filter((hold) => hold.expires_at <= d.at)
        .map((hold) => hold.id)
        .sort();
      for (const holdId of due) {
        const hold = findHold(d, holdId);
        if (hold) {
          returnToBuckets(d, hold, "release", hold.from_purchased, hold.from_monthly);
        }
      }
      return { ok: true, released: due };
    }

    case "refund": {
      requirePositive("credits", command.credits);
      move(d, command.bucket, command.credits, "refund", command.user_id ?? null, command.ref);
      return { ok: true };
    }

    case "clawback": {
      requirePositive("credits", command.credits);
      const removed = Math.min(command.credits, d.balances.purchased);
      move(d, "purchased", -removed, "clawback", null, command.ref);
      return { ok: true, removed };
    }

    case "reset": {
      requireNonNegative("credits", command.credits);
      move(d, "monthly", command.credits - d.balances.monthly, "reset", null, command.id);
      d.balances = { ...d.balances, monthly_resets_at: command.resets_at };
      return { ok: true };
    }
  }
}

// Changes one bucket by delta and records one entry, unless delta is 0.
function move(
  d: Draft,
  bucket: Bucket,
  delta: number,
  kind: EntryKind,
  userId: string | null,
  ref: string,
): void {
  if (delta === 0) return;
  d.balances =
    bucket === "monthly"
      ? { ...d.balances, monthly: d.balances.monthly + delta }
      : { ...d.balances, purchased: d.balances.purchased + delta };
  d.entries.push({
    id: `${d.command}:${d.entries.length}`,
    at: d.at,
    user_id: userId,
    kind,
    bucket,
    credits: delta,
    ref,
  });
}

// Gives credits back to purchased first, then monthly, and deletes the hold.
function returnToBuckets(
  d: Draft,
  hold: Hold,
  kind: "settle" | "release",
  toPurchased: number,
  toMonthly: number,
): void {
  move(d, "purchased", toPurchased, kind, hold.user_id, hold.id);
  move(d, "monthly", toMonthly, kind, hold.user_id, hold.id);
  delete d.holds[hold.id];
}

function findHold(d: Draft, holdId: string): Hold | undefined {
  return Object.hasOwn(d.holds, holdId) ? d.holds[holdId] : undefined;
}

function requirePositive(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function requireNonNegative(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}
