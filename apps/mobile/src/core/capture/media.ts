import type { SqlDb } from "../db/sql.ts";
import { studyLines } from "./segments.ts";

// A photo (from a recording, at time t) or a page (from a pages session, by number).
export type MediaItem = { id: string; kind: "photo" | "page"; file: string; t: number; page: number | null };
// url is the absolute http(s) address (new URL(...).href); host is what the row shows (new URL(...).hostname).
export type FoundLink = { url: string; host: string };
// Where a link was written: a transcript line or a photo (t), or a page (captureId and page).
export type SessionLink = FoundLink & { t: number | null; captureId: string | null; page: number | null };

export function sessionMedia(db: SqlDb, sessionId: string): MediaItem[] {
  const pages = db
    .all<{ id: string; file: string }>("SELECT id, file FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id", [sessionId])
    .map((row, index): MediaItem => ({ id: row.id, kind: "page", file: row.file, t: 0, page: index + 1 }));
  const photos = db
    .all<{ id: string; file: string; t: number }>("SELECT id, file, t FROM captures WHERE session_id = ? AND kind = 'photo' ORDER BY t, id", [sessionId])
    .map((row): MediaItem => ({ id: row.id, kind: "photo", file: row.file, t: row.t, page: null }));
  return [...pages, ...photos];
}

// A web address: text with an explicit http:// or https:// scheme (any letter case), or one starting with www. Nothing
// else counts, so a file name such as index.html or main.py is not a link. Not part of a longer word, or an email address.
const CANDIDATE = /(?<![\p{L}\p{N}@./_-])(?:https?:\/\/|www\.)[^\s<>"'“”‘’]+/giu;
const MAX_LINK = 2000;
const TRAILING_PUNCTUATION = ".,;:!?'\"。、…";
const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

// Drops trailing punctuation, and a closing bracket only when it has no opening one in the address (Wikipedia's Foo_(bar) keeps its ")").
function trimCandidate(text: string): string {
  let out = text;
  for (;;) {
    const last = out.slice(-1);
    if (last === "") return out;
    if (TRAILING_PUNCTUATION.includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    const opener = PAIRS[last];
    if (opener !== undefined && count(out, last) > count(out, opener)) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

// Every distinct web address in the text, in order, as an absolute http(s) URL (WHATWG href, so the scheme is lower-case and
// the host is punycode) with the host name to show. An address over 2000 characters is not a link. Each address once: an
// address that differs only by a trailing "/" or the case of its host is the same one.
export function findLinks(text: string): FoundLink[] {
  const seen = new Set<string>();
  const out: FoundLink[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const raw = trimCandidate(match[0]);
    if (raw.length > MAX_LINK) continue;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.hostname === "" || url.hostname.endsWith(".")) continue;
    const key = url.href.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: url.href, host: url.hostname });
  }
  return out;
}

// The session's links: from pages first (by number), then from the transcript the person keeps (studyLines, so hidden
// lines give none) and photos in time order. Each address once.
export function sessionLinks(db: SqlDb, sessionId: string): SessionLink[] {
  const pages = db.all<{ id: string; found_text: string | null }>(
    "SELECT id, found_text FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id",
    [sessionId],
  );
  const photos = db.all<{ id: string; t: number; found_text: string | null }>(
    "SELECT id, t, found_text FROM captures WHERE session_id = ? AND kind = 'photo' ORDER BY t, id",
    [sessionId],
  );
  const timed = [
    ...studyLines(db, sessionId).map((line) => ({ t: line.tStart, text: line.text, captureId: null as string | null })),
    ...photos.map((photo) => ({ t: photo.t, text: photo.found_text ?? "", captureId: photo.id as string | null })),
  ].sort((a, b) => a.t - b.t);
  const out: SessionLink[] = [];
  const seen = new Set<string>();
  const add = (links: FoundLink[], where: { t: number | null; captureId: string | null; page: number | null }) => {
    for (const link of links) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      out.push({ ...link, ...where });
    }
  };
  pages.forEach((page, index) => add(findLinks(page.found_text ?? ""), { t: null, captureId: page.id, page: index + 1 }));
  for (const item of timed) add(findLinks(item.text), { t: item.t, captureId: item.captureId, page: null });
  return out;
}
