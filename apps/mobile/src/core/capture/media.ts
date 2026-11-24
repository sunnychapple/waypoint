import type { SqlDb } from "../db/sql.ts";
import { studyLines } from "./segments.ts";

// A photo (from a recording, at time t) or a page (from a pages session, by number).
export type MediaItem = { id: string; kind: "photo" | "page"; file: string; t: number; page: number | null };
export type FoundLink = { url: string; shown: string; host: string };
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

// A web address: with http:// or https://, or a name with dots ending in 2 to 24 lower-case letters (example.org,
// www.example.org/lesson-12). Not part of a longer word or an email address.
const LINK = /(?<![\p{L}\p{N}@._/-])(?:https?:\/\/[^\s<>"'“”‘’]+|(?:[\p{L}\p{N}-]+\.)+[a-z]{2,24}(?:\/[^\s<>"'“”‘’]*)?)(?![\p{L}\p{N}@])/gu;
const TRAILING = /[.,;:!?)\]}'"”’]+$/;

// Every distinct web address in the text, in order, made openable (https:// added when it has no scheme).
export function findLinks(text: string): FoundLink[] {
  const seen = new Set<string>();
  const out: FoundLink[] = [];
  for (const match of text.matchAll(LINK)) {
    const raw = match[0].replace(TRAILING, "");
    if (raw === "") continue;
    const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const shown = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    out.push({ url, shown, host: (shown.split("/")[0] ?? shown).replace(/^www\./, "") });
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
