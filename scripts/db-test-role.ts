/**
 * Creates a NON-SUPERUSER login role for tests and local development.
 *
 * This exists because superusers (and any role with BYPASSRLS) ignore row-level
 * security entirely — even with FORCE ROW LEVEL SECURITY set. Running the
 * authorization suite as the migration owner made every isolation test pass
 * vacuously: Bob could read Alice's rows, and the assertions that caught it were
 * the only reason we noticed.
 *
 * Tests therefore connect as this role, which holds exactly the grants app_web
 * has in production. The test harness and production now differ only in hostname.
 *
 * Run: pnpm db:test-role   (idempotent)
 */
import postgres from 'postgres';
import { targetDatabase } from './lib/target-db';

/* Refuses to guess when the environment names two different databases. This
   creates a login role; doing that to the wrong one is not a silent mistake
   you want to discover later. */
let admin: string;
try {
  const target = targetDatabase('db-test-role');
  console.log(`database : ${target.label}   (from ${target.source})`);
  admin = target.url;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
}

const ROLE = process.env.TEST_DB_ROLE ?? 'throughline_app';
const PASSWORD = process.env.TEST_DB_PASSWORD ?? 'throughline_local_dev';

const sql = postgres(admin, { max: 1, onnotice: () => {} });

const main = async (): Promise<void> => {
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
        CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}';
      ELSE
        ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${PASSWORD}';
      END IF;
    END $$;
  `);
  // Explicitly NOT a superuser and explicitly NOT bypassing RLS. Stated rather
  // than assumed, because the default changing would silently gut the suite.
  await sql.unsafe(`ALTER ROLE ${ROLE} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await sql.unsafe(`GRANT app_web TO ${ROLE}`);

  const db = await sql<{ current_database: string }[]>`SELECT current_database()`;
  await sql.unsafe(`GRANT CONNECT ON DATABASE "${db[0]!.current_database}" TO ${ROLE}`);

  const [check] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${ROLE}`;
  if (check?.rolsuper || check?.rolbypassrls) {
    console.error(`db-test-role: ${ROLE} can bypass RLS — the authz suite would be meaningless`);
    process.exit(1);
  }
  // The authentication role, so the bootstrap path can be tested as production
  // will actually run it rather than as a superuser that bypasses everything.
  const AUTH_ROLE = process.env.TEST_AUTH_ROLE ?? 'throughline_auth';
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${AUTH_ROLE}') THEN
        CREATE ROLE ${AUTH_ROLE} LOGIN PASSWORD '${PASSWORD}';
      ELSE
        ALTER ROLE ${AUTH_ROLE} WITH LOGIN PASSWORD '${PASSWORD}';
      END IF;
    END $$;
  `);
  await sql.unsafe(`ALTER ROLE ${AUTH_ROLE} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await sql.unsafe(`GRANT app_auth TO ${AUTH_ROLE}`);
  await sql.unsafe(`GRANT CONNECT ON DATABASE "${db[0]!.current_database}" TO ${AUTH_ROLE}`);

  console.log(`db-test-role: ${ROLE} ready (nosuperuser, nobypassrls, member of app_web)`);
  console.log(`db-test-role: ${AUTH_ROLE} ready (member of app_auth)`);
  await sql.end();
};

main().catch(async (e) => {
  console.error('db-test-role FAILED:', e instanceof Error ? e.message : e);
  await sql.end();
  process.exit(1);
});
