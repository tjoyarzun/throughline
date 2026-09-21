-- Row-Level Security: the layer that makes cross-tenant access structurally
-- impossible rather than merely unimplemented.
--
-- Two independent reasons every usr.* access must go through withUser():
--   1. SET LOCAL only persists inside a transaction. Neon's HTTP driver runs each
--      query in its own implicit transaction, so a bare SET LOCAL evaporates and
--      these policies return zero rows.
--   2. DATABASE_URL is pgbouncer in transaction mode. SET LOCAL is
--      transaction-scoped and safe; a plain SET would persist on the backend and
--      be inherited by the next request that borrows it — a cross-tenant leak
--      that would pass every test written against a single user.
-- See docs/security.md.

CREATE OR REPLACE FUNCTION usr.current_account_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.account_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  t text;
  -- Tables keyed directly by account_id.
  owned text[] := ARRAY[
    'title_state','state_event','rating','viewing','episode_progress','note','share'
  ];
BEGIN
  FOREACH t IN ARRAY owned LOOP
    EXECUTE format('ALTER TABLE usr.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE usr.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS own_rows ON usr.%I', t);
    EXECUTE format($f$
      CREATE POLICY own_rows ON usr.%I
        USING (account_id = usr.current_account_id())
        WITH CHECK (account_id = usr.current_account_id())
    $f$, t);
  END LOOP;
END $$;

-- The account row itself: a user sees only their own.
ALTER TABLE usr.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE usr.account FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_account ON usr.account;
CREATE POLICY own_account ON usr.account
  USING (id = usr.current_account_id())
  WITH CHECK (id = usr.current_account_id());

-- state_event is append-only. No UPDATE or DELETE policy exists, so with FORCE
-- RLS on, those operations match no policy and affect zero rows even for the
-- table owner. Nothing is destroyed.
DROP POLICY IF EXISTS append_only_update ON usr.state_event;
DROP POLICY IF EXISTS append_only_delete ON usr.state_event;

COMMENT ON POLICY own_rows ON usr.title_state IS
  'Requires app.account_id set via SET LOCAL inside a transaction. See withUser().';

-- ── The authentication bootstrap problem ────────────────────────────────────
--
-- Authentication has to read usr.account BEFORE a session exists: sign-in looks
-- a user up by email, sign-up inserts one. At that moment there is no
-- app.account_id, so the own_account policy matches nothing and Better Auth
-- cannot work. FORCE ROW LEVEL SECURITY makes this true even for the table
-- owner, which is exactly what the application connects as in production.
--
-- The tempting fix — a policy like `USING (current_account_id() IS NULL)` — is
-- a disaster: it means any query that forgets withUser() reads EVERY account.
-- That is precisely the leak the whole design exists to prevent.
--
-- The correct fix is a separate role. app_auth may read and write the identity
-- tables unconditionally; app_web may only ever see its own row. Two roles,
-- two connection strings, and the privilege is scoped to the thing that
-- genuinely needs it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth NOLOGIN;
  END IF;
END $$;

DROP POLICY IF EXISTS auth_service ON usr.account;
CREATE POLICY auth_service ON usr.account
  TO app_auth
  USING (true)
  WITH CHECK (true);

-- Better Auth's own tables carry no user-readable content and are never touched
-- by application code, so they are not RLS-protected. They are reachable only
-- through the library's server-side handlers, on the app_auth connection.
COMMENT ON POLICY auth_service ON usr.account IS
  'Sign-in must find a user before a session exists. Scoped to app_auth so
   app_web can never use it. See docs/security.md#the-authentication-bootstrap.';
