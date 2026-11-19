-- Groups, invites and membership (PR 27). Ids, roles and times only: the group's name stays locked
-- (groups.name_locked) and an invite is stored only as the SHA-256 of its token.

-- Who made the invite (an owner), what the new member may read and until when.
ALTER TABLE invites ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE CASCADE;
-- Unix ms. The new member reads changes from this time on; 0 means the whole history.
ALTER TABLE invites ADD COLUMN history_from INTEGER NOT NULL DEFAULT 0;
-- Unix ms. The membership ends then (the hourly cron ends it and bumps the key version); NULL means no end.
ALTER TABLE invites ADD COLUMN ends_at INTEGER;

-- The hourly cron looks for memberships whose end date has passed.
CREATE INDEX memberships_ends_at ON memberships (ends_at) WHERE ends_at IS NOT NULL AND left_at IS NULL;
