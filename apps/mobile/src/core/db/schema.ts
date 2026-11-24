export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX spaces_one_default ON spaces (is_default) WHERE is_default = 1;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces (id),
  kind TEXT NOT NULL CHECK (kind IN ('recording', 'pages')),
  title TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('recording', 'paused', 'saved', 'interrupted')),
  transcript TEXT NOT NULL DEFAULT 'none' CHECK (transcript IN ('none', 'live', 'waiting', 'done', 'failed')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  recorded_ms INTEGER NOT NULL DEFAULT 0 CHECK (recorded_ms >= 0),
  indexed_at INTEGER
);
CREATE INDEX sessions_space ON sessions (space_id, started_at);

CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t_start INTEGER NOT NULL CHECK (t_start >= 0),
  t_end INTEGER NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('device', 'cloud')),
  CHECK (t_end >= t_start),
  UNIQUE (session_id, source, t_start)
);

CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'photo', 'page')),
  t INTEGER NOT NULL CHECK (t >= 0),
  position INTEGER NOT NULL DEFAULT 0,
  file TEXT NOT NULL,
  duration_ms INTEGER,
  found_text TEXT,
  found_lines TEXT
);
CREATE INDEX captures_session ON captures (session_id, kind, position);

CREATE TABLE flags (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t INTEGER NOT NULL CHECK (t >= 0),
  question TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answered', 'dismissed'))
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('term', 'problem', 'question')),
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  capture_id TEXT REFERENCES captures (id) ON DELETE SET NULL,
  t INTEGER,
  made_by TEXT NOT NULL CHECK (made_by IN ('device_model', 'quiz_miss')),
  created_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  fsrs TEXT NOT NULL
);
CREATE INDEX cards_due ON cards (due_at);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  reviewed_at INTEGER NOT NULL,
  due_before INTEGER NOT NULL,
  due_after INTEGER NOT NULL
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('transcript', 'page', 'photo')),
  capture_id TEXT REFERENCES captures (id) ON DELETE CASCADE,
  t_start INTEGER NOT NULL,
  t_end INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX chunks_session ON chunks (session_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5 (text, content = 'chunks', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2');
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TABLE search_index (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks (id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  dim INTEGER NOT NULL CHECK (dim > 0),
  scale REAL NOT NULL,
  vector BLOB NOT NULL
);
CREATE INDEX search_index_model ON search_index (model_version);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
CREATE TABLE explanations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t INTEGER NOT NULL CHECK (t >= 0),
  term TEXT NOT NULL CHECK (length(term) BETWEEN 1 AND 100),
  thread TEXT NOT NULL DEFAULT '[]',
  saved INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX explanations_session ON explanations (session_id, t);

CREATE TABLE terms (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  explanation_id TEXT NOT NULL UNIQUE REFERENCES explanations (id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  meaning TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sent_log (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL CHECK (task IN ('explain', 'more_detail', 'double_check', 'read_link', 'research', 'overview_script', 'video_slides', 'diagram', 'mini_app', 'practice', 'retranscribe')),
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  sent TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  credits INTEGER CHECK (credits >= 0),
  retention TEXT CHECK (retention IN ('standard', 'zero')),
  at INTEGER NOT NULL
);
CREATE INDEX sent_log_at ON sent_log (at);
`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('research', 'overview_script', 'video_slides', 'diagram', 'mini_app', 'practice', 'retranscribe')),
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  request_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  quoted INTEGER NOT NULL CHECK (quoted >= 1),
  spent INTEGER CHECK (spent >= 0),
  result_ready INTEGER NOT NULL DEFAULT 0 CHECK (result_ready IN (0, 1)),
  detail TEXT NOT NULL DEFAULT '{}',
  saved_at INTEGER,
  deleted_at INTEGER,
  problem TEXT CHECK (problem IN ('unreadable')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX jobs_open ON jobs (deleted_at, created_at);
CREATE INDEX jobs_session ON jobs (session_id, created_at);
`,
  },
  {
    version: 4,
    sql: `
CREATE TABLE research (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  depth TEXT NOT NULL CHECK (depth IN ('quick', 'standard', 'deep')),
  answer TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX research_session ON research (session_id, created_at);
`,
  },
  {
    version: 5,
    sql: `
CREATE TABLE made (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('diagram', 'mini_app', 'practice')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX made_session ON made (session_id, created_at);
`,
  },
  {
    version: 6,
    sql: `
CREATE TABLE overviews (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
  title TEXT NOT NULL,
  script TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'script' CHECK (state IN ('script', 'rendering', 'ready', 'failed', 'no_voices')),
  file TEXT,
  duration_ms INTEGER CHECK (duration_ms >= 0),
  line_starts TEXT NOT NULL DEFAULT '[]',
  voices TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX overviews_session ON overviews (session_id, created_at);
`,
  },
  {
    version: 7,
    sql: `
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared')),
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  created_by TEXT,
  history_from INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER,
  members TEXT NOT NULL DEFAULT '[]',
  left_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE key_versions (
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  learned_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, key_version)
);

CREATE TABLE known_accounts (
  user_id TEXT PRIMARY KEY,
  sign_pub TEXT NOT NULL,
  pending_sign_pub TEXT,
  first_seen INTEGER NOT NULL,
  changed_at INTEGER
);

CREATE TABLE trusted_signers (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  sign_pub TEXT NOT NULL,
  box_pub TEXT NOT NULL,
  cert TEXT NOT NULL
);
`,
  },
  {
    version: 8,
    sql: `
CREATE TABLE space_groups (
  space_id TEXT PRIMARY KEY REFERENCES spaces (id) ON DELETE CASCADE,
  group_id TEXT NOT NULL UNIQUE REFERENCES groups (id) ON DELETE CASCADE
);

CREATE TABLE sync_state (
  group_id TEXT PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  pulled_at INTEGER
);

-- Sent in seq order (the order collectChanges queued them: parents before children).
CREATE TABLE outbox (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  blob_capture_id TEXT,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- The newest write this iPhone knows for each synced row, its own (written by collectChanges) or received.
-- row_id is the row's id; for segments "<session>:<source>:<10-minute bucket>"; for a space, the group id.
CREATE TABLE row_versions (
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  PRIMARY KEY (table_name, row_id)
);

-- Received changes whose session (or a card's capture) has not arrived yet; applied when it does. At most 2,000 per
-- group (the oldest go first).
CREATE TABLE sync_pending (
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  wait_for TEXT NOT NULL,
  at INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (group_id, table_name, row_id)
);
CREATE INDEX sync_pending_wait ON sync_pending (group_id, wait_for);

-- Filled by the triggers below when this iPhone changes a row (plain inserts: a trigger's OR REPLACE is not reliable
-- under foreign-key actions), only once some space syncs; emptied by collectChanges, which uses each row's last entry.
-- A deleted row keeps the group it belonged to, found before it was gone.
CREATE TABLE dirty (
  seq INTEGER PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  group_id TEXT
);

-- applying is 1 while applyChange writes, so changes that arrive are not sent back. clock is the newest change time
-- this iPhone has made or applied; its next change is stamped later than it (a phone with a slow clock still wins
-- over what it has already seen).
CREATE TABLE sync_mode (
  applying INTEGER NOT NULL CHECK (applying IN (0, 1)),
  clock INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sync_mode (applying, clock) VALUES (0, 0);

ALTER TABLE captures ADD COLUMN blob_id TEXT;

CREATE TRIGGER sync_spaces_update AFTER UPDATE OF name ON spaces WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('spaces', new.id, 0, NULL);
END;
CREATE TRIGGER sync_sessions_insert AFTER INSERT ON sessions WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('sessions', new.id, 0, NULL);
END;
CREATE TRIGGER sync_sessions_update AFTER UPDATE OF space_id, kind, title, state, transcript, started_at, ended_at, recorded_ms ON sessions WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('sessions', new.id, 0, NULL);
END;
CREATE TRIGGER sync_captures_insert AFTER INSERT ON captures WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('captures', new.id, 0, NULL);
END;
CREATE TRIGGER sync_captures_update AFTER UPDATE OF session_id, kind, t, position, duration_ms, found_text, found_lines, blob_id ON captures WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('captures', new.id, 0, NULL);
END;
CREATE TRIGGER sync_flags_insert AFTER INSERT ON flags WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('flags', new.id, 0, NULL);
END;
CREATE TRIGGER sync_flags_update AFTER UPDATE OF session_id, t, question, state ON flags WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('flags', new.id, 0, NULL);
END;
CREATE TRIGGER sync_cards_insert AFTER INSERT ON cards WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('cards', new.id, 0, NULL);
END;
CREATE TRIGGER sync_cards_update AFTER UPDATE OF session_id, kind, front, back, capture_id, t, made_by, created_at, due_at, fsrs ON cards WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('cards', new.id, 0, NULL);
END;
CREATE TRIGGER sync_sessions_delete AFTER DELETE ON sessions WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('sessions', old.id, 1, (SELECT group_id FROM space_groups WHERE space_id = old.space_id));
END;
CREATE TRIGGER sync_captures_delete AFTER DELETE ON captures WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('captures', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
CREATE TRIGGER sync_flags_delete AFTER DELETE ON flags WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('flags', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
CREATE TRIGGER sync_cards_delete AFTER DELETE ON cards WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('cards', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
CREATE TRIGGER sync_segments_insert AFTER INSERT ON segments WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('segments', new.session_id || ':' || new.source || ':' || (new.t_start / 600000), 0, NULL);
END;
CREATE TRIGGER sync_segments_update AFTER UPDATE ON segments WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('segments', new.session_id || ':' || new.source || ':' || (new.t_start / 600000), 0, NULL);
END;
CREATE TRIGGER sync_segments_delete AFTER DELETE ON segments WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('segments', old.session_id || ':' || old.source || ':' || (old.t_start / 600000), 0, NULL);
END;
`,
  },
  {
    version: 9,
    sql: `
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions (id) ON DELETE SET NULL,
  group_id TEXT NOT NULL,
  url TEXT NOT NULL,
  has_passcode INTEGER NOT NULL CHECK (has_passcode IN (0, 1)),
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX links_session ON links (session_id, created_at);
`,
  },
  {
    version: 10,
    sql: `
ALTER TABLE flags ADD COLUMN capture_id TEXT REFERENCES captures (id) ON DELETE SET NULL;
ALTER TABLE explanations ADD COLUMN capture_id TEXT REFERENCES captures (id) ON DELETE SET NULL;
`,
  },
  {
    version: 11,
    sql: `
-- A transcript line the person changed (Next 1): their words (NULL shows what was heard), hidden, who said it, and
-- highlighted words as [[first, last], ...] word positions. The heard line in segments is never changed. id is
-- "<session id>:<t_start>", so two phones marking the same line write the same row.
CREATE TABLE line_marks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t_start INTEGER NOT NULL CHECK (t_start >= 0),
  text TEXT CHECK (text IS NULL OR length(text) <= 2000),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  speaker TEXT CHECK (speaker IS NULL OR length(speaker) BETWEEN 1 AND 40),
  highlights TEXT NOT NULL DEFAULT '[]' CHECK (length(highlights) <= 20000) CHECK (json_valid(highlights)),
  updated_at INTEGER NOT NULL,
  UNIQUE (session_id, t_start)
);

-- A note the person typed, placed in the recording's timeline at t; quote holds the words it was made from, or ''.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t INTEGER NOT NULL CHECK (t >= 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  quote TEXT NOT NULL DEFAULT '' CHECK (length(quote) <= 300),
  created_at INTEGER NOT NULL
);
CREATE INDEX notes_session ON notes (session_id, t);

CREATE TRIGGER sync_line_marks_insert AFTER INSERT ON line_marks WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('line_marks', new.id, 0, NULL);
END;
CREATE TRIGGER sync_line_marks_update AFTER UPDATE OF session_id, t_start, text, hidden, speaker, highlights, updated_at ON line_marks WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('line_marks', new.id, 0, NULL);
END;
CREATE TRIGGER sync_line_marks_delete AFTER DELETE ON line_marks WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('line_marks', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
CREATE TRIGGER sync_notes_insert AFTER INSERT ON notes WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('notes', new.id, 0, NULL);
END;
CREATE TRIGGER sync_notes_update AFTER UPDATE OF session_id, t, text, quote ON notes WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('notes', new.id, 0, NULL);
END;
CREATE TRIGGER sync_notes_delete AFTER DELETE ON notes WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('notes', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
`,
  },
  {
    // Card P2. Adds problem_help to the CHECKs of jobs and sent_log (SQLite rebuilds a table to change a CHECK: same
    // columns in the same order, every row copied, then its indexes again), and keeps cloud help answers on this iPhone.
    version: 12,
    sql: `
CREATE TABLE jobs_new (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('research', 'overview_script', 'video_slides', 'diagram', 'mini_app', 'practice', 'retranscribe', 'problem_help')),
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  request_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  quoted INTEGER NOT NULL CHECK (quoted >= 1),
  spent INTEGER CHECK (spent >= 0),
  result_ready INTEGER NOT NULL DEFAULT 0 CHECK (result_ready IN (0, 1)),
  detail TEXT NOT NULL DEFAULT '{}',
  saved_at INTEGER,
  deleted_at INTEGER,
  problem TEXT CHECK (problem IN ('unreadable')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO jobs_new (id, type, session_id, request_key, state, quoted, spent, result_ready, detail, saved_at, deleted_at, problem, created_at, updated_at)
  SELECT id, type, session_id, request_key, state, quoted, spent, result_ready, detail, saved_at, deleted_at, problem, created_at, updated_at FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
CREATE INDEX jobs_open ON jobs (deleted_at, created_at);
CREATE INDEX jobs_session ON jobs (session_id, created_at);

CREATE TABLE sent_log_new (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL CHECK (task IN ('explain', 'more_detail', 'double_check', 'read_link', 'research', 'overview_script', 'video_slides', 'diagram', 'mini_app', 'practice', 'retranscribe', 'problem_help')),
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  sent TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  credits INTEGER CHECK (credits >= 0),
  retention TEXT CHECK (retention IN ('standard', 'zero')),
  at INTEGER NOT NULL
);
INSERT INTO sent_log_new (id, task, session_id, sent, bytes, credits, retention, at)
  SELECT id, task, session_id, sent, bytes, credits, retention, at FROM sent_log;
DROP TABLE sent_log;
ALTER TABLE sent_log_new RENAME TO sent_log;
CREATE INDEX sent_log_at ON sent_log (at);

CREATE TABLE help_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions (id) ON DELETE CASCADE,
  capture_id TEXT REFERENCES captures (id) ON DELETE CASCADE,
  problem TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX help_answers_session ON help_answers (session_id, created_at);
`,
  },
];
