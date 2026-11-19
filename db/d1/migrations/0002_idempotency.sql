-- Stored replies for repeated write requests (PR 11). Never holds note content: only routes whose
-- replies have none use this table. Rows older than 24 hours are ignored and cleaned up later (PR 33).
CREATE TABLE idempotency (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'done')),
  status INTEGER,
  body TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX idempotency_created_at ON idempotency (created_at);
