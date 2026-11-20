import type { GroupView } from "@waypoint/contracts";

// Shared spaces (M30a): the labels, access choices and rules the share screens use. No I/O here.
export type Role = GroupView["role"];
export type Member = GroupView["members"][number];

const DAY_MS = 24 * 60 * 60 * 1000;

// "You" for this person, "Owner" for another owner, and "Member 1, 2…" for the others, by join order (starts_at).
export function memberLabels(members: readonly Member[], me: string): Map<string, string> {
  const labels = new Map<string, string>();
  const others = members
    .filter((m) => m.user_id !== me && m.role !== "owner")
    .sort((a, b) => a.starts_at - b.starts_at || (a.user_id < b.user_id ? -1 : 1));
  for (const m of members) {
    if (m.user_id === me) labels.set(m.user_id, "You");
    else if (m.role === "owner") labels.set(m.user_id, "Owner");
  }
  others.forEach((m, i) => labels.set(m.user_id, `Member ${i + 1}`));
  return labels;
}

// "No end", "1 week", "1 month" or "3 months" from now. null is no end date.
export type InviteAccess = "none" | "week" | "month" | "quarter";
const ACCESS_DAYS: Record<Exclude<InviteAccess, "none">, number> = { week: 7, month: 30, quarter: 90 };

export function inviteEnds(choice: InviteAccess, now: number): number | null {
  return choice === "none" ? null : now + ACCESS_DAYS[choice] * DAY_MS;
}

// The safety code for a pending account key: the first 12 hex characters of its SHA-256, in groups of 4.
export function safetyCode(hexSha256: string): string {
  const twelve = hexSha256.slice(0, 12);
  return `${twelve.slice(0, 4)} ${twelve.slice(4, 8)} ${twelve.slice(8, 12)}`;
}

// Only an owner invites (PR 27).
export function canInvite(role: Role): boolean {
  return role === "owner";
}

// An owner removes editors and viewers. A member who is not an owner cannot remove anyone (leaving is separate).
export function canRemove(myRole: Role, target: Role): boolean {
  return myRole === "owner" && target !== "owner";
}
