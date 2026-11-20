-- What a running job needs after POST /v1/jobs has replied (PR 20). Ids, sizes, route and times only; never the
-- text sent or the result.
-- The request's Idempotency-Key. The wallet ids are job:<user id>:<key>, job_settle:<user id>:<key>, job_release:<user id>:<key>.
ALTER TABLE jobs ADD COLUMN command_key TEXT;
-- The model that writes the result (jobs.route is its tier) and the retention of that route.
ALTER TABLE jobs ADD COLUMN model TEXT;
ALTER TABLE jobs ADD COLUMN retention TEXT CHECK (retention IN ('standard', 'zero'));
-- UTF-8 bytes of the text sent (0 for retranscribe; its usage event carries the audio bytes).
ALTER TABLE jobs ADD COLUMN bytes_sent INTEGER NOT NULL DEFAULT 0;
-- Work stops at this time; the wallet hold expires HOLD_MARGIN_MS later.
ALTER TABLE jobs ADD COLUMN deadline_at INTEGER;
ALTER TABLE jobs ADD COLUMN finished_at INTEGER;
