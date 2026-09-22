-- The entire background job system, per docs/adr/0011.

-- Atomically claim up to n queued jobs. FOR UPDATE SKIP LOCKED is what makes
-- concurrent drains safe: two workers never receive the same job, and neither
-- blocks the other.
-- Claims are a LEASE, not a permanent mark.
--
-- A worker that dies mid-job -- function timeout, deploy, instance recycled --
-- leaves its job in 'running' with nothing to finish it. Claiming only 'queued'
-- rows stranded that work permanently and silently: it is not queued, so depth
-- looks healthy; not failed, so nothing alerts; and never retried. One
-- FUNCTION_INVOCATION_TIMEOUT on a Wikidata job is how this was found.
--
-- So a 'running' row whose lease has expired is claimable again. The lease is
-- five minutes -- comfortably longer than any function may run, so a lease that
-- old means the worker is definitively gone, never merely slow. attempts still
-- increments, so fail_job's cap applies and a genuinely poisonous job stops
-- rather than cycling forever.
-- Dropped explicitly: adding the lease parameter changes the signature, and
-- CREATE OR REPLACE would leave the old two-argument version in place as an
-- OVERLOAD. Two-argument calls would keep resolving to it -- the reclaim would
-- appear to ship while every caller still used the version without it.
DROP FUNCTION IF EXISTS core.claim_jobs(int, text);

CREATE OR REPLACE FUNCTION core.claim_jobs(n int, worker text, lease interval DEFAULT interval '5 minutes')
RETURNS SETOF core.job AS $$
  UPDATE core.job j
  SET status = 'running', locked_at = now(), locked_by = worker, attempts = j.attempts + 1
  WHERE j.id IN (
    SELECT id FROM core.job
    WHERE (status = 'queued' AND run_after <= now())
       OR (status = 'running' AND locked_at < now() - lease)
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
  -- PENDING work only, not running work.
  --
  -- Including 'running' silently killed every self-chaining job. A job that
  -- walks a backlog enqueues its successor while it is itself running, with
  -- the same payload -- so it matched ITSELF, the insert was skipped, and the
  -- chain stopped after exactly one link. hydrate_people and refresh_stale
  -- both looked like they worked: they ran, reported success, and quietly did
  -- one batch instead of the backlog.
  --
  -- Dedupe exists so the same pending work is not queued twice. A job that is
  -- already running is no longer pending, and every handler is idempotent, so
  -- the worst case here is one redundant batch rather than a stalled walk.
  SELECT id INTO existing FROM core.job
  WHERE kind = job_kind AND payload = job_payload AND status = 'queued'
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

-- ── Share capabilities ──────────────────────────────────────────────────────
--
-- usr.share is RLS-scoped to its owner, which is correct and which makes the
-- PUBLIC share page unreadable: a visitor has no session, so
-- current_account_id() is null and the policy returns nothing.
--
-- The tempting fix is a policy that lets anyone read shares. That would hand
-- every share to any query that forgot to scope itself -- the same trap the
-- auth bootstrap policy documents. Instead these two functions are the only
-- way in, and they are shaped like the capability the URL already is: they
-- take an exact slug and return AT MOST one row. Neither can enumerate, list,
-- or filter, so holding a link gets you that link and nothing else.
CREATE OR REPLACE FUNCTION usr.share_by_slug(p_slug text)
RETURNS TABLE (
  title_id uuid,
  display_name text,
  include_rating boolean,
  rating_snapshot smallint,
  note_snapshot text,
  message text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = usr, core, pg_temp
AS $$
  SELECT s.title_id, a.display_name, s.include_rating, s.rating_snapshot,
         s.note_snapshot, s.message, s.created_at
  FROM usr.share s
  JOIN usr.account a ON a.id = s.account_id
  WHERE s.slug = p_slug AND s.revoked_at IS NULL
  LIMIT 1;
$$;

-- Counting a view must not require being able to read the row.
CREATE OR REPLACE FUNCTION usr.share_record_view(p_slug text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = usr, pg_temp
AS $$
  UPDATE usr.share SET view_count = view_count + 1
  WHERE slug = p_slug AND revoked_at IS NULL;
$$;

-- ── Admin ───────────────────────────────────────────────────────────────────
--
-- Admin reads cross account boundaries, which is exactly what RLS exists to
-- prevent, so each one is SECURITY DEFINER and checks the caller FIRST. The
-- privilege check lives with the privilege: a future caller that forgets to
-- check is refused by the database rather than trusted.
--
-- current_account_id() comes from app.account_id, set by withUser(). With no
-- session it is null, is_admin is false, and every function here refuses.
CREATE OR REPLACE FUNCTION usr.assert_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = usr, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM usr.account
    WHERE id = usr.current_account_id() AND is_admin AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not an admin' USING ERRCODE = '42501';
  END IF;
END $$;

/*
 * Everyone, with the numbers that say whether they are actually using it.
 *
 * The streak counts CONSECUTIVE DAYS ending today or yesterday. Ending
 * yesterday still counts: a streak should not appear broken first thing in the
 * morning before you have opened the app.
 */
DROP FUNCTION IF EXISTS usr.admin_users();
DROP FUNCTION IF EXISTS usr.admin_sessions(uuid);
DROP FUNCTION IF EXISTS usr.admin_revoke_session(text);
DROP FUNCTION IF EXISTS usr.admin_create_invite(text, text, int);
DROP FUNCTION IF EXISTS usr.admin_invites();
DROP FUNCTION IF EXISTS usr.admin_revoke_invite(text);

CREATE OR REPLACE FUNCTION usr.admin_users()
RETURNS TABLE (
  account_id uuid,
  email text,
  display_name text,
  is_admin boolean,
  created_at timestamptz,
  watched int,
  rated int,
  episodes int,
  last_login timestamptz,
  streak int,
  active_sessions int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = usr, core, pg_temp
AS $$
BEGIN
  -- PERFORM, as a STATEMENT.
  --
  -- The first version put the check in a WHERE clause as
  -- `(SELECT 1 FROM (SELECT assert_admin()) _) IS NOT NULL`, and the planner
  -- elided it: a non-admin got every row, and so did a caller with no session
  -- at all. A guard whose result is unused is not guaranteed to run. In
  -- plpgsql the statement order is the contract.
  PERFORM usr.assert_admin();
  RETURN QUERY
  SELECT
    a.id, a.email::text, a.display_name, a.is_admin, a.created_at,
    (SELECT count(*)::int FROM usr.title_state t
      WHERE t.account_id = a.id AND t.status = 'watched'),
    (SELECT count(*)::int FROM usr.rating r
      WHERE r.account_id = a.id AND r.superseded_at IS NULL),
    (SELECT count(*)::int FROM usr.episode_progress p WHERE p.account_id = a.id),
    (SELECT max(s.created_at) FROM usr.auth_session s WHERE s.user_id = a.id),
    COALESCE((
      -- Gaps and islands: number each distinct login day, subtract the row
      -- number, and consecutive days share a value. Count the run containing
      -- today or yesterday.
      WITH days AS (
        SELECT DISTINCT s.created_at::date AS d
        FROM usr.auth_session s WHERE s.user_id = a.id
      ), grouped AS (
        SELECT d, d - (row_number() OVER (ORDER BY d))::int AS grp FROM days
      )
      SELECT count(*)::int FROM grouped
      WHERE grp = (SELECT grp FROM grouped ORDER BY d DESC LIMIT 1)
        AND (SELECT max(d) FROM days) >= now()::date - 1
    ), 0),
    (SELECT count(*)::int FROM usr.auth_session s
      WHERE s.user_id = a.id AND s.expires_at > now())
  FROM usr.account a
  WHERE a.deleted_at IS NULL
  ORDER BY a.created_at;
END $$;

/* Devices, so access can be revoked per device rather than everywhere. */
CREATE OR REPLACE FUNCTION usr.admin_sessions(p_account uuid)
RETURNS TABLE (
  -- TEXT, not uuid: Better Auth owns this table and generates its own ids.
  session_id text,
  user_agent text,
  ip_address text,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = usr, pg_temp
AS $$
BEGIN
  PERFORM usr.assert_admin();
  RETURN QUERY
  SELECT s.id, s.user_agent, s.ip_address, s.created_at, s.expires_at
  FROM usr.auth_session s
  WHERE s.user_id = p_account AND s.expires_at > now()
  ORDER BY s.created_at DESC;
END $$;

/* Revoking deletes the session outright: an expired-but-present row is a
   credential that still exists, and the point is that it should not. */
CREATE OR REPLACE FUNCTION usr.admin_revoke_session(p_session text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = usr, pg_temp
AS $$
DECLARE n int;
BEGIN
  PERFORM usr.assert_admin();
  DELETE FROM usr.auth_session WHERE id = p_session;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION usr.admin_create_invite(p_code text, p_email text, p_days int)
RETURNS TABLE (code text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = usr, pg_temp
AS $$
BEGIN
  PERFORM usr.assert_admin();
  RETURN QUERY
  INSERT INTO usr.invite (code, email, created_by, expires_at)
  VALUES (p_code, nullif(p_email, ''), usr.current_account_id(),
          now() + make_interval(days => p_days))
  RETURNING usr.invite.code::text, usr.invite.expires_at;
END $$;

CREATE OR REPLACE FUNCTION usr.admin_invites()
RETURNS TABLE (
  code text,
  email text,
  expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by_email text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = usr, pg_temp
AS $$
BEGIN
  PERFORM usr.assert_admin();
  RETURN QUERY
  SELECT i.code::text, i.email::text, i.expires_at, i.redeemed_at,
         r.email::text, i.created_at
  FROM usr.invite i
  LEFT JOIN usr.account r ON r.id = i.redeemed_by
  ORDER BY i.created_at DESC
  LIMIT 100;
END $$;

CREATE OR REPLACE FUNCTION usr.admin_revoke_invite(p_code text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = usr, pg_temp
AS $$
DECLARE n int;
BEGIN
  PERFORM usr.assert_admin();
  DELETE FROM usr.invite WHERE code = p_code AND redeemed_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
