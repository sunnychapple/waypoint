import { SharedItemSchema, type SharedItem } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";
import { studyLines } from "../capture/segments.ts";
import { utf8Length } from "../explain/sent.ts";

// Shared links (M30b). The item is one session as text; the link key is made natively (lockLink) and lives only in the
// URL fragment and in this phone's links table. The server stores the locked bytes and nothing readable.
export const LINK_MAX_BYTES = 4_000_000;
const TRANSCRIPT_LINE_MAX = 10_000;
const TRANSCRIPT_LINES_MAX = 20_000;
const PAGE_TEXT_MAX = 50_000;
const PAGES_MAX = 200;
const DAY_MS = 86_400_000;

export type LinkExpiry = "none" | "day" | "week" | "month";
export type LinkRow = {
  id: string;
  sessionId: string | null;
  groupId: string;
  url: string;
  hasPasscode: boolean;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

type SessionText = { title: string; started_at: number };

// The session as SharedItem JSON: its title, when it started, the device transcript as { t, text } lines and the page
// text. Anything past SharedItemSchema's limits is cut. When the item is over maxBytes, transcript lines are dropped
// from the end; when the pages alone are still over, pages are dropped from the end and the last one kept is
// shortened. cut is true whenever anything was left out.
export function sharedItem(db: SqlDb, sessionId: string, maxBytes = LINK_MAX_BYTES): { item: SharedItem; cut: boolean } | null {
  const session = db.get<SessionText>("SELECT title, started_at FROM sessions WHERE id = ?", [sessionId]);
  if (session === null) return null;
  // The transcript as the person edited it, without hidden lines (studyLines).
  const allLines = studyLines(db, sessionId).map((line) => ({ t: line.tStart, text: line.text }));
  const allPages = db.all<{ text: string | null }>("SELECT found_text AS text FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id", [
    sessionId,
  ]);
  let cut = allLines.length > TRANSCRIPT_LINES_MAX || allPages.length > PAGES_MAX;
  const lines = allLines.slice(0, TRANSCRIPT_LINES_MAX).map((r) => {
    if (r.text.length > TRANSCRIPT_LINE_MAX) cut = true;
    return { t: r.t, text: r.text.slice(0, TRANSCRIPT_LINE_MAX) };
  });
  const pages = allPages.slice(0, PAGES_MAX).map((r) => {
    const text = r.text ?? "";
    if (text.length > PAGE_TEXT_MAX) cut = true;
    return { text: text.slice(0, PAGE_TEXT_MAX) };
  });
  const build = (count: number, kept: { text: string }[]): SharedItem => ({
    v: 1,
    kind: "session",
    title: session.title.slice(0, 200).trim() || "Untitled session",
    created_at: Math.max(0, session.started_at),
    transcript: lines.slice(0, count),
    pages: kept,
  });
  const fits = (item: SharedItem): boolean => utf8Length(JSON.stringify(item)) <= maxBytes;
  // The size grows with each count, so the largest count that fits is found by bisection.
  const largest = (max: number, ok: (n: number) => boolean): number => {
    let low = 0;
    let high = max;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (ok(mid)) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  const count = largest(lines.length, (n) => fits(build(n, pages)));
  let kept = pages;
  if (count < lines.length) cut = true;
  if (!fits(build(count, pages))) {
    const whole = largest(pages.length, (n) => fits(build(0, pages.slice(0, n))));
    const next = pages[whole]?.text ?? "";
    const chars = largest(next.length, (n) => fits(build(0, [...pages.slice(0, whole), { text: next.slice(0, n) }])));
    kept = chars > 0 ? [...pages.slice(0, whole), { text: next.slice(0, chars) }] : pages.slice(0, whole);
    cut = true;
  }
  const item = SharedItemSchema.parse(build(count, kept));
  return { item, cut };
}

// The URL: the key only after "#k=", which a browser never sends to the server.
export function linkUrl(apiUrl: string, linkId: string, key: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/l/${linkId}#k=${key}`;
}

// The expiry time for a choice made at `now` ("1 month" is 30 days, as for invites); null for no expiry.
export function expiryFor(choice: LinkExpiry, now: number): number | null {
  if (choice === "none") return null;
  if (choice === "day") return now + DAY_MS;
  if (choice === "week") return now + 7 * DAY_MS;
  return now + 30 * DAY_MS;
}

type LinkDbRow = {
  id: string;
  session_id: string | null;
  group_id: string;
  url: string;
  has_passcode: number;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
};

const toRow = (r: LinkDbRow): LinkRow => ({
  id: r.id,
  sessionId: r.session_id,
  groupId: r.group_id,
  url: r.url,
  hasPasscode: r.has_passcode === 1,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  createdAt: r.created_at,
});

// Keeps a link made on this iPhone, with its URL (it holds the key).
export function recordLink(
  db: SqlDb,
  link: { id: string; sessionId: string; groupId: string; url: string; hasPasscode: boolean; expiresAt: number | null; createdAt: number },
): void {
  db.run(
    "INSERT INTO links (id, session_id, group_id, url, has_passcode, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    [link.id, link.sessionId, link.groupId, link.url, link.hasPasscode ? 1 : 0, link.expiresAt, link.createdAt],
  );
}

// The links made for one session, newest first (revoked ones included).
export function linksForSession(db: SqlDb, sessionId: string): LinkRow[] {
  return db.all<LinkDbRow>("SELECT * FROM links WHERE session_id = ? ORDER BY created_at DESC, id", [sessionId]).map(toRow);
}

// Marks a link revoked once; a second call changes nothing.
export function markRevoked(db: SqlDb, id: string, at: number): void {
  db.run("UPDATE links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", [at, id]);
}
