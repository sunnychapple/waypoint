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
];
