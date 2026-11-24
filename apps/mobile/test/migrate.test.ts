import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../src/core/db/schema.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { createMemoryDb } from "./helpers/db.ts";

const version = (db: ReturnType<typeof createMemoryDb>) =>
  db.get<{ user_version: number }>("PRAGMA user_version")?.user_version;

describe("migrate", () => {
  it("a new database ends at version 13, and a second run changes nothing", () => {
    const db = createMemoryDb();
    expect(migrate(db)).toBe(13);
    expect(migrate(db)).toBe(13);
    expect(version(db)).toBe(13);
  });

  it("version 12 keeps every jobs and sent_log row and index, and accepts problem_help", () => {
    const db = createMemoryDb();
    migrate(db, MIGRATIONS.filter((m) => m.version <= 11));
    db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('s1', 'Notes', 1, 1, 1)");
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('x1', 's1', 'pages', 'Pages', 'saved', 1)");
    db.run(
      `INSERT INTO jobs (id, type, session_id, request_key, state, quoted, spent, result_ready, detail, saved_at, deleted_at, problem, created_at, updated_at)
       VALUES ('j1', 'practice', 'x1', 'k1', 'succeeded', 8, 8, 1, '{"kind":"practice"}', 5, 6, 'unreadable', 1, 2)`,
    );
    db.run("INSERT INTO sent_log (id, task, session_id, sent, bytes, credits, retention, at) VALUES ('k1', 'practice', 'x1', '{}', 2, 8, 'standard', 3)");
    const jobs = db.all("SELECT * FROM jobs");
    const sent = db.all("SELECT * FROM sent_log");
    expect(migrate(db)).toBe(13);
    expect(db.all("SELECT * FROM jobs")).toEqual(jobs);
    expect(db.all("SELECT * FROM sent_log")).toEqual(sent);
    const indexes = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('jobs', 'sent_log') AND sql IS NOT NULL ORDER BY name");
    expect(indexes.map((i) => i.name)).toEqual(["jobs_open", "jobs_session", "sent_log_at"]);
    db.run("INSERT INTO jobs (id, type, session_id, request_key, state, quoted, created_at, updated_at) VALUES ('j2', 'problem_help', 'x1', 'k2', 'queued', 5, 1, 1)");
    db.run("INSERT INTO sent_log (id, task, session_id, sent, bytes, at) VALUES ('k2', 'problem_help', 'x1', '{}', 2, 3)");
    expect(() => db.run("INSERT INTO jobs (id, type, request_key, state, quoted, created_at, updated_at) VALUES ('j3', 'summarize', 'k3', 'queued', 5, 1, 1)")).toThrow();
    db.run("DELETE FROM sessions WHERE id = 'x1'");
    expect(db.all("SELECT id FROM jobs")).toEqual([]);
    expect(db.all("SELECT id FROM sent_log")).toEqual([]);
  });

  it("a user_version above the latest migration throws", () => {
    const db = createMemoryDb();
    db.exec("PRAGMA user_version = 99");
    expect(() => migrate(db)).toThrow("database is newer than this app");
  });

  it("a failing migration leaves the version where it was, keeps none of its tables, and rethrows", () => {
    const db = createMemoryDb();
    const broken = [
      { version: 1, sql: "CREATE TABLE ok_one (id INTEGER);" },
      { version: 2, sql: "CREATE TABLE half_done (id INTEGER); THIS IS NOT SQL;" },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(version(db)).toBe(1);
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).toContain("ok_one");
    expect(tables).not.toContain("half_done");
  });
});
