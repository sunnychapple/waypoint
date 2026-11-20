import type { SqlDb } from "../db/sql.ts";

// A device or account row that must hold a group's key (GET /v1/groups/:id/devices).
export type Target = {
  id: string;
  user_id: string;
  kind: "device" | "account";
  role: "owner" | "editor" | "viewer";
  sign_pub: string;
  box_pub: string;
  cert: string | null;
  has_current_key: boolean;
};

export type CertCheck = (c: { accountSignPub: string; cert: string; userId: string; deviceId: string; signPub: string; boxPub: string }) => boolean;

// Trust on first use (docs/security.md section 6). The first account key seen for a person is kept; a different one
// later is held as pending (the "security key changed" notice) until the person accepts it. This iPhone's own
// person always uses the account key it holds.
export function noteAccounts(db: SqlDb, targets: Target[], me: { userId: string; accountSignPub: string }, now: number): string[] {
  const changed: string[] = [];
  db.run(
    "INSERT INTO known_accounts (user_id, sign_pub, first_seen) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET sign_pub = excluded.sign_pub, pending_sign_pub = NULL",
    [me.userId, me.accountSignPub, now],
  );
  for (const t of targets) {
    if (t.kind !== "account" || t.user_id === me.userId) continue;
    const known = db.get<{ sign_pub: string; pending_sign_pub: string | null }>("SELECT sign_pub, pending_sign_pub FROM known_accounts WHERE user_id = ?", [t.user_id]);
    if (known === null) {
      db.run("INSERT INTO known_accounts (user_id, sign_pub, first_seen) VALUES (?, ?, ?)", [t.user_id, t.sign_pub, now]);
    } else if (known.sign_pub !== t.sign_pub && known.pending_sign_pub !== t.sign_pub) {
      db.run("UPDATE known_accounts SET pending_sign_pub = ?, changed_at = ? WHERE user_id = ?", [t.sign_pub, now, t.user_id]);
      changed.push(t.user_id);
    }
  }
  return changed;
}

// The person tapped "Trust the new key" for this member.
export function acceptNewAccountKey(db: SqlDb, userId: string): void {
  db.run("UPDATE known_accounts SET sign_pub = pending_sign_pub, pending_sign_pub = NULL WHERE user_id = ? AND pending_sign_pub IS NOT NULL", [userId]);
}

export function changedAccounts(db: SqlDb): { userId: string; changedAt: number }[] {
  return db.all<{ userId: string; changedAt: number }>(
    "SELECT user_id AS userId, changed_at AS changedAt FROM known_accounts WHERE pending_sign_pub IS NOT NULL ORDER BY changed_at",
  );
}

// user id → the account signing key this iPhone trusts for them (what waypoint-keys gets as knownAccounts).
export function knownAccounts(db: SqlDb): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of db.all<{ user_id: string; sign_pub: string }>("SELECT user_id, sign_pub FROM known_accounts")) out[r.user_id] = r.sign_pub;
  return out;
}

// A target is trusted when its row is the person's known account key, or a device certified by it.
export function isTrusted(t: Target, known: Record<string, string>, verify: CertCheck): boolean {
  const account = known[t.user_id];
  if (account === undefined) return false;
  if (t.kind === "account") return t.sign_pub === account;
  return t.cert !== null && verify({ accountSignPub: account, cert: t.cert, userId: t.user_id, deviceId: t.id, signPub: t.sign_pub, boxPub: t.box_pub });
}

// What this iPhone should do for a group's current key version (docs/security.md section 10).
export type KeyPlan =
  | { kind: "first"; recipients: Target[] } // nobody has the current version: make it and wrap for every target
  | { kind: "add"; recipients: Target[] } // wrap the held current key for targets that lack it and that we may serve
  | { kind: "blocked"; untrusted: Target[] } // a first set must cover every target, and some are not trusted
  | { kind: "none" };

export function planKeys(input: { targets: Target[]; me: { userId: string; role: "owner" | "editor" | "viewer" }; holdsCurrent: boolean; known: Record<string, string>; verify: CertCheck }): KeyPlan {
  const { targets, me, holdsCurrent, known, verify } = input;
  const nobody = targets.every((t) => !t.has_current_key);
  if (nobody && !holdsCurrent) {
    const untrusted = targets.filter((t) => !isTrusted(t, known, verify));
    return untrusted.length > 0 ? { kind: "blocked", untrusted } : { kind: "first", recipients: targets };
  }
  if (!holdsCurrent) return { kind: "none" };
  // Only an owner wraps for another member's devices (H2); anyone wraps for their own devices and account row.
  const recipients = targets.filter((t) => !t.has_current_key && (me.role === "owner" || t.user_id === me.userId) && isTrusted(t, known, verify));
  return recipients.length > 0 ? { kind: "add", recipients } : { kind: "none" };
}

// Which older key versions a new member gets: everything held when the invite said "from the start" (history_from 0),
// otherwise the versions this iPhone learned at or after history_from, and always the current one.
export function versionsFor(held: { keyVersion: number; learnedAt: number }[], historyFrom: number, current: number): number[] {
  const out = new Set<number>([current]);
  for (const h of held) if (historyFrom === 0 || h.learnedAt >= historyFrom) out.add(h.keyVersion);
  return [...out].filter((v) => held.some((h) => h.keyVersion === v)).sort((a, b) => a - b);
}

// A random wait of 0 to 30 s before making a missing key, so two devices rarely race (docs/security.md section 10).
export function firstSetDelayMs(random: () => number): number {
  return Math.floor(Math.min(0.999999, Math.max(0, random())) * 30_000);
}
