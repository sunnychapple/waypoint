-- Device keys, device pairing and signed requests (docs/security.md). Holds public keys, signatures,
-- commitments, nonces and wrapped (encrypted) keys only. Never a private key, never note content.

-- kind 'account' is the account key's row: one active row per user, never a phone.
ALTER TABLE devices ADD COLUMN kind TEXT NOT NULL DEFAULT 'device' CHECK (kind IN ('device', 'account'));
ALTER TABLE devices ADD COLUMN approved_at INTEGER;
ALTER TABLE devices ADD COLUMN approved_by TEXT;
-- The account key's signature over this device's keys (base64url). NULL for account rows and pending devices.
ALTER TABLE devices ADD COLUMN cert TEXT;
-- The account key wrapped for this device by the device that approved it (base64url envelope).
ALTER TABLE devices ADD COLUMN account_envelope TEXT;
CREATE UNIQUE INDEX devices_one_account ON devices (user_id) WHERE kind = 'account' AND removed_at IS NULL;

-- One row per device waiting for approval with the 6-digit code.
CREATE TABLE device_pairings (
  device_id TEXT NOT NULL PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  commitment TEXT NOT NULL,
  approver_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
  approver_nonce TEXT,
  device_nonce TEXT,
  expires_at INTEGER NOT NULL
);

-- Nonces of signed requests, kept until the request's timestamp is out of the replay window.
CREATE TABLE request_nonces (
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, nonce)
);
CREATE INDEX request_nonces_expires_at ON request_nonces (expires_at);

-- The device a job's result is sealed to (S4). Set by POST /v1/jobs from the request signature.
ALTER TABLE jobs ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;
