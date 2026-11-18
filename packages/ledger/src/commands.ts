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
// Only successful results are remembered by command id, so a failed command can be retried with the same id.
export function apply(state: WalletState, command: Command, now: number): ApplyOutput {
  requireId("command id", command.id);
  requireTime("now", now);

  const prior = Object.hasOwn(state.applied, command.id) ? state.applied[command.id] : undefined;
  if (prior !== undefined) {
    if (prior.type !== command.type) {
      throw new Error("command id reused for a different command");
    }
    return { state, entries: [], result: prior.result };
  }

  const draft: Draft = {
    balances: { ...state.balances },
    holds: { ...state.holds },
    entries: [],
    command: command.id,
    at: now,
  };
  const result = Object.freeze(execute(draft, command));

  const applied = result.ok
    ? {
        ...state.applied,
        [command.id]: Object.freeze({ type: command.type, result }),
      }
    : state.applied;

  return {
    state: {
      balances: draft.balances,
      holds: draft.holds,
      applied,
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
      requireId("hold_id", command.hold_id);
      requirePositive("credits", command.credits);
      requireTime("expires_at", command.expires_at);
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
      requireId("hold_id", command.hold_id);
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
      requireId("hold_id", command.hold_id);
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
      return { ok: true, released: Object.freeze(due) };
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
      requireTime("resets_at", command.resets_at);
      move(d, "monthly", command.credits - d.balances.monthly, "reset", null, command.id);
      d.balances = { ...d.balances, monthly_resets_at: command.resets_at };
      return { ok: true };
    }

    default:
      throw new Error("unknown command type");
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
  const next = (bucket === "monthly" ? d.balances.monthly : d.balances.purchased) + delta;
  if (next > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${bucket} balance would exceed Number.MAX_SAFE_INTEGER`);
  }
  d.balances =
    bucket === "monthly"
      ? { ...d.balances, monthly: next }
      : { ...d.balances, purchased: next };
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

// Command and hold ids: 1 to 128 of A-Z, a-z, 0-9, _, : or -, and not an object-prototype key.
const ID_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);

function requireId(name: string, value: string): void {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || RESERVED_IDS.has(value)) {
    throw new RangeError(`${name} must be 1-128 letters, digits, _, : or -`);
  }
}

// Unix milliseconds: a safe integer, zero or more.
function requireTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
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
