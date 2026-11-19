import { MIGRATIONS } from "./schema.ts";
import type { SqlDb } from "./sql.ts";

// Applies every migration above the database's user_version, in order. Each one runs in its own
// transaction together with its version bump, so a failed migration leaves the version unchanged.
export function migrate(db: SqlDb, migrations = MIGRATIONS): number {
  const current = db.get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0;
  const latest = Math.max(0, ...migrations.map((m) => m.version));
  if (current > latest) throw new Error("database is newer than this app");
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
  return db.get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0;
}
