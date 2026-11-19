-- APNs device tokens (PR 31). One row per signed-in app install; a token belongs to one user at a time.
-- device_id is the device's id in devices (S1B), which the app registers before it asks for push. No foreign key, so
-- this table does not depend on the S1 cards; S1F deletes a removed device's row.
CREATE TABLE push_tokens (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
