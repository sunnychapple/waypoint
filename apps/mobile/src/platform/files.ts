import { Directory, File, Paths } from "expo-file-system";

// Paths in this app are relative to the Documents folder, as the pages module returns them.
export function fileUri(relative: string): string {
  return new File(Paths.document, relative).uri;
}

// Ignores a file that is already gone.
export function deleteFile(relative: string): void {
  const file = new File(Paths.document, relative);
  if (file.exists) file.delete();
}

export function deleteSessionFiles(sessionId: string): void {
  const folder = new Directory(Paths.document, "sessions", sessionId);
  if (folder.exists) folder.delete();
}

// What these sessions' recordings and pages take. The sessions folder is shared by everyone who signs in on this iPhone
// (each session has its own random id), so only the open person's sessions are counted (open question 52).
export function sessionsBytes(sessionIds: readonly string[]): number {
  let bytes = 0;
  for (const id of sessionIds) {
    const folder = new Directory(Paths.document, "sessions", id);
    if (folder.exists) bytes += folder.info().size ?? 0;
  }
  return bytes;
}

// A temporary file for locked media (M29b), at the Documents root (the keys module reads paths there). The caller deletes it.
export function blobTempPath(name: string): string {
  return `blob-${name}.tmp`;
}
