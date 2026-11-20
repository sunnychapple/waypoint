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

-- A leave or removal that would end the group's last active owner is refused, even when two owners leave at once.
-- Owner memberships never expire (the cron skips them), so only leave and removal reach this.
CREATE TRIGGER memberships_keep_an_owner
BEFORE UPDATE OF left_at ON memberships
WHEN OLD.role = 'owner' AND OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
  AND (SELECT COUNT(*) FROM memberships
       WHERE group_id = OLD.group_id AND role = 'owner' AND left_at IS NULL AND user_id <> OLD.user_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'last owner');
END;
