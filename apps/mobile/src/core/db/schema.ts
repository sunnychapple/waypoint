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
  state TEXT NOT NULL DEFAULT 'script' CHECK (state IN ('script', 'rendering', 'ready', 'failed')),
  file TEXT,
  duration_ms INTEGER CHECK (duration_ms >= 0),
  line_starts TEXT NOT NULL DEFAULT '[]',
  voices TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX overviews_session ON overviews (session_id, created_at);
`,
  },
];
