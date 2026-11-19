import type { SqlDb } from "./sql.ts";

export function getSetting(db: SqlDb, key: string): string | null {
  return db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key])?.value ?? null;
}

export function setSetting(db: SqlDb, key: string, value: string): void {
  db.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export function deleteSetting(db: SqlDb, key: string): void {
  db.run("DELETE FROM settings WHERE key = ?", [key]);
}
