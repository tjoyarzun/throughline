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

const admin = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!admin) {
  console.error('db-test-role: DATABASE_URL must be set');
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
  console.log(`db-test-role: ${ROLE} ready (nosuperuser, nobypassrls, member of app_web)`);
  await sql.end();
};

main().catch(async (e) => {
  console.error('db-test-role FAILED:', e instanceof Error ? e.message : e);
  await sql.end();
  process.exit(1);
});
