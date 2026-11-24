-- Adds the problem_help job type (card P1). SQLite cannot change a CHECK in place, so jobs is rebuilt: a new table with
-- the same columns in the same order, every row copied, the old table dropped, the new one renamed, the index made again.
-- No table, trigger or view refers to jobs, so nothing else changes.
PRAGMA defer_foreign_keys = true;

CREATE TABLE jobs_new (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'research', 'overview_script', 'video_slides', 'diagram',
    'mini_app', 'practice', 'retranscribe', 'problem_help'
  )),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  quoted INTEGER NOT NULL,
  spent INTEGER,
  route TEXT,
  result_key TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  command_key TEXT,
  model TEXT,
  retention TEXT CHECK (retention IN ('standard', 'zero')),
  bytes_sent INTEGER NOT NULL DEFAULT 0,
  deadline_at INTEGER,
  finished_at INTEGER
);

INSERT INTO jobs_new (
  id, user_id, type, state, quoted, spent, route, result_key, created_at, expires_at,
  device_id, command_key, model, retention, bytes_sent, deadline_at, finished_at
)
SELECT
  id, user_id, type, state, quoted, spent, route, result_key, created_at, expires_at,
  device_id, command_key, model, retention, bytes_sent, deadline_at, finished_at
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
CREATE INDEX jobs_user_id_created_at ON jobs(user_id, created_at);
