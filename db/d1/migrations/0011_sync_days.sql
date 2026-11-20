-- Bytes of locked changes and shared-link data each person sent per UTC day (day = Unix ms / 86,400,000, rounded
-- down), against their daily budget (open question 55). Sizes only.
CREATE TABLE sync_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
-- Extra bytes bought for a day (POST /v1/sync/extra, card D5), one row per purchase. The key is the purchase's
-- Idempotency-Key, so a purchase that runs again can never add its bytes twice.
CREATE TABLE sync_extras (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  day INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
