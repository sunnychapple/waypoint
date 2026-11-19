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

export function sessionsBytes(): number {
  const folder = new Directory(Paths.document, "sessions");
  return folder.exists ? (folder.info().size ?? 0) : 0;
}
