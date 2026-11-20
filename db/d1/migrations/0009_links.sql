-- Shared links (PR 30): who made a link and when. The link's key is only in the URL fragment; the server keeps the
-- locked data in R2 (links/{id}/data) and a peppered passcode hash.
ALTER TABLE links ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE links ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
