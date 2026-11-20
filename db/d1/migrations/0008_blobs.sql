-- Locked media files in R2 at groups/{group_id}/media/{id} (PR 29). Sizes only, never content. user_id is who
-- uploaded the file and whose 3 GB it counts against; stored_at is NULL while the upload is still running.
CREATE TABLE blobs (
  id TEXT NOT NULL PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  stored_at INTEGER
);
CREATE INDEX blobs_user_id ON blobs (user_id);
CREATE INDEX blobs_group_id ON blobs (group_id);
