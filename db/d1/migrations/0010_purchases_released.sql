-- Own it and Plus rows of an account that was deleted (Clerk user.deleted, open question 7). The next account to send
-- such a transaction claims its rows once: the entitlement only, never the credits or the monthly reset it already gave.
ALTER TABLE purchases ADD COLUMN released_at INTEGER;
-- Accounts deleted before this migration: their rows are released now (0: the time is not known).
UPDATE purchases SET released_at = 0
  WHERE kind IN ('non_consumable', 'subscription') AND billing_account_id NOT IN (SELECT billing_account_id FROM users);
