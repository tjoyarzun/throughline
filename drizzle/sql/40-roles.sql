-- Database roles. This is what makes "a user can never contaminate the global
-- model" a structural guarantee instead of a code review convention:
-- app_web has no write grant on core and no grant at all on raw.
--
-- Roles are cluster-wide; creation is guarded so this file stays idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_web') THEN
    CREATE ROLE app_web NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ingest') THEN
    CREATE ROLE app_ingest NOLOGIN;
  END IF;
END $$;

-- ── app_web: serves requests ────────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA raw FROM app_web;
REVOKE ALL ON SCHEMA raw FROM app_web;

GRANT USAGE ON SCHEMA core, sem, usr TO app_web;
GRANT SELECT ON ALL TABLES IN SCHEMA core TO app_web;
GRANT SELECT ON ALL TABLES IN SCHEMA sem  TO app_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA usr TO app_web;

-- Append-only in the strongest available sense: no UPDATE or DELETE grant at all.
REVOKE UPDATE, DELETE ON usr.state_event FROM app_web;

ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT SELECT ON TABLES TO app_web;
ALTER DEFAULT PRIVILEGES IN SCHEMA sem  GRANT SELECT ON TABLES TO app_web;
ALTER DEFAULT PRIVILEGES IN SCHEMA usr  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_web;

-- ── app_ingest: writes the global model, cannot see user data ───────────────
GRANT USAGE ON SCHEMA raw, core, sem TO app_ingest;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA raw  TO app_ingest;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO app_ingest;
GRANT SELECT ON ALL TABLES IN SCHEMA sem TO app_ingest;
REVOKE ALL ON SCHEMA usr FROM app_ingest;

ALTER DEFAULT PRIVILEGES IN SCHEMA raw  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_ingest;

GRANT EXECUTE ON FUNCTION core.uuid_generate_v7()      TO app_web, app_ingest;
GRANT EXECUTE ON FUNCTION core.normalize_title(text)   TO app_web, app_ingest;
GRANT EXECUTE ON FUNCTION usr.current_account_id()     TO app_web;

GRANT EXECUTE ON FUNCTION core.claim_jobs(int, text)            TO app_ingest;
GRANT EXECUTE ON FUNCTION core.finish_job(uuid)                 TO app_ingest;
GRANT EXECUTE ON FUNCTION core.fail_job(uuid, text, int)        TO app_ingest;
GRANT EXECUTE ON FUNCTION core.enqueue_job(text, jsonb)         TO app_web, app_ingest;
GRANT EXECUTE ON FUNCTION core.recency_decay(timestamptz)       TO app_web, app_ingest;

-- ── app_auth: authentication only ───────────────────────────────────────────
-- Deliberately narrow. It can manage identities and sessions and nothing else —
-- no ratings, no viewing history, no notes, no global model.
GRANT USAGE ON SCHEMA usr TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON usr.account            TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON usr.auth_session       TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON usr.oauth_account      TO app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON usr.auth_verification  TO app_auth;
GRANT SELECT, UPDATE                 ON usr.invite             TO app_auth;
REVOKE ALL ON usr.title_state, usr.state_event, usr.rating, usr.viewing,
              usr.episode_progress, usr.note, usr.share FROM app_auth;
GRANT EXECUTE ON FUNCTION core.uuid_generate_v7() TO app_auth;

-- app_web must never reach the auth tables directly; it goes through the
-- library, which uses the app_auth connection.
REVOKE ALL ON usr.auth_session, usr.oauth_account, usr.auth_verification FROM app_web;
