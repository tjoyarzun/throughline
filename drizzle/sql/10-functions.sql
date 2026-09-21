-- The entire background job system, per docs/adr/0011.

-- Atomically claim up to n queued jobs. FOR UPDATE SKIP LOCKED is what makes
-- concurrent drains safe: two workers never receive the same job, and neither
-- blocks the other.
CREATE OR REPLACE FUNCTION core.claim_jobs(n int, worker text)
RETURNS SETOF core.job AS $$
  UPDATE core.job j
  SET status = 'running', locked_at = now(), locked_by = worker, attempts = j.attempts + 1
  WHERE j.id IN (
    SELECT id FROM core.job
    WHERE status = 'queued' AND run_after <= now()
    ORDER BY run_after, id
    LIMIT n
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION core.finish_job(job_id uuid) RETURNS void AS $$
  UPDATE core.job SET status = 'done', finished_at = now(), last_error = NULL
  WHERE id = job_id;
$$ LANGUAGE sql;

-- Exponential backoff, capped at 5 attempts. A job that has exhausted its
-- attempts is marked failed and surfaces on /api/health — it is never retried
-- silently forever, and never dropped without a trace.
CREATE OR REPLACE FUNCTION core.fail_job(job_id uuid, err text, max_attempts int DEFAULT 5)
RETURNS void AS $$
  UPDATE core.job
  SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
      run_after = now() + (interval '30 seconds' * power(2, least(attempts, 6))),
      last_error = err
  WHERE id = job_id;
$$ LANGUAGE sql;

-- Enqueue without duplicating: the same work queued twice while still pending
-- is one job, not two.
CREATE OR REPLACE FUNCTION core.enqueue_job(job_kind text, job_payload jsonb)
RETURNS uuid AS $$
DECLARE existing uuid; new_id uuid;
BEGIN
  SELECT id INTO existing FROM core.job
  WHERE kind = job_kind AND payload = job_payload AND status IN ('queued', 'running')
  LIMIT 1;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  INSERT INTO core.job (kind, payload) VALUES (job_kind, job_payload) RETURNING id INTO new_id;
  RETURN new_id;
END $$ LANGUAGE plpgsql;

-- Recency weighting for taste affinity. Half-life of roughly a year: what you
-- watched last month should count more than what you watched in 2019, but not
-- so much more that old favorites vanish.
CREATE OR REPLACE FUNCTION core.recency_decay(ts timestamptz) RETURNS numeric AS $$
  SELECT CASE
    WHEN ts IS NULL THEN 0.5
    ELSE greatest(0.25, exp(-0.0019 * extract(epoch FROM (now() - ts)) / 86400.0))::numeric
  END;
$$ LANGUAGE sql STABLE;
