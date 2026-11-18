-- D1 directory schema (docs/architecture.md section 5).
-- Holds accounts, devices, groups, memberships, invites, links, purchases, jobs
-- and activity. Never holds note, transcript or page text.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  clerk_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus', 'own')),
  billing_account_id TEXT NOT NULL,
  zero_retention INTEGER NOT NULL DEFAULT 0 CHECK (zero_retention IN (0, 1))
);

CREATE TABLE entitlements (
  user_id TEXT NOT NULL REFERENCES users(id),
  product TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('purchase', 'family_share')),
  media_cap_gb INTEGER NOT NULL DEFAULT 3,
  granted_at INTEGER NOT NULL,
  ended_at INTEGER,
  PRIMARY KEY (user_id, product, source)
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  sign_pub TEXT NOT NULL,
  box_pub TEXT NOT NULL,
  can_approve INTEGER NOT NULL DEFAULT 0 CHECK (can_approve IN (0, 1)),
  added_at INTEGER NOT NULL,
  removed_at INTEGER
);
CREATE INDEX devices_user_id ON devices(user_id);

CREATE TABLE recovery (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  wrapped_account_key TEXT NOT NULL,
  verified_at INTEGER
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared')),
  name_locked INTEGER NOT NULL DEFAULT 0 CHECK (name_locked IN (0, 1)),
  key_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE memberships (
  group_id TEXT NOT NULL REFERENCES groups(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  history_from INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX memberships_user_id ON memberships(user_id);

CREATE TABLE key_envelopes (
  group_id TEXT NOT NULL REFERENCES groups(id),
  key_version INTEGER NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  wrapped_key TEXT NOT NULL,
  PRIMARY KEY (group_id, key_version, device_id)
);

CREATE TABLE invites (
  token_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  expires_at INTEGER NOT NULL,
  accepted_by TEXT REFERENCES users(id)
);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id),
  blob_key TEXT NOT NULL,
  passcode_hash TEXT,
  expires_at INTEGER,
  revoked_at INTEGER,
  views INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX links_group_id ON links(group_id);

CREATE TABLE purchases (
  transaction_id TEXT PRIMARY KEY,
  original_id TEXT NOT NULL,
  billing_account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('consumable', 'subscription', 'non_consumable')),
  status TEXT NOT NULL CHECK (status IN ('active', 'refunded', 'revoked', 'expired')),
  purchased_at INTEGER NOT NULL
);
CREATE INDEX purchases_original_id ON purchases(original_id);
CREATE INDEX purchases_billing_account_id ON purchases(billing_account_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN (
    'research', 'overview_script', 'video_slides', 'diagram',
    'mini_app', 'practice', 'retranscribe'
  )),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  quoted INTEGER NOT NULL,
  spent INTEGER,
  route TEXT,
  result_key TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX jobs_user_id_created_at ON jobs(user_id, created_at);

CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task TEXT NOT NULL,
  bytes_sent INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL,
  route TEXT NOT NULL,
  retention TEXT NOT NULL CHECK (retention IN ('standard', 'zero')),
  at INTEGER NOT NULL
);
CREATE INDEX activity_user_id_at ON activity(user_id, at);
