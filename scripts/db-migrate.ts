/**
 * Applies the database in the only order that works:
 *
 *   1. bootstrap   schemas, extensions, uuid_generate_v7 (tables depend on it)
 *   2. tables      drizzle-kit migrations
 *   3. ontology    GENERATED constraints + trigger + predicate_meta
 *   4. views       sem.* (depend on tables and predicate_meta)
 *   5. matviews    depend on views
 *   6. rls         depends on tables
 *   7. roles       depends on everything having been created
 *
 * Steps 1 and 3-7 are idempotent by construction and re-run every time. Step 2
 * is the only stateful one.
 *
 * Always uses the DIRECT connection: DDL and advisory locks are unreliable
 * through pgbouncer.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { directDatabaseUrl, describeUrl, AUTH_ROLE } from '@/server/db/resolve-url';

const resolved = directDatabaseUrl();
if (!resolved) {
  console.error(
    'db-migrate: no database URL found. Set one of DATABASE_URL_UNPOOLED, ' +
      'POSTGRES_URL_NON_POOLING, or DATABASE_URL.',
  );
  process.exit(2);
}
const { url, name: urlVarName } = resolved;

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function runFile(path: string, label: string): Promise<void> {
  const body = readFileSync(path, 'utf8');
  const started = Date.now();
  await sql.unsafe(body);
  console.log(`  ✓ ${label} (${Date.now() - started}ms)`);
}

/**
 * Give app_auth a role that can actually connect.
 *
 * app_auth is created NOLOGIN -- it is a bundle of grants, not an identity.
 * Production therefore needs a login role that holds it, and the password has
 * to come from somewhere that is not this repository.
 *
 * NON-FATAL by design. A managed Postgres may refuse CREATE ROLE, and a
 * deploy that dies because an optional hardening step was unavailable is worse
 * than one that ships and says so: authentication still works through the
 * fallback, loudly, and nothing else in the migration depends on this.
 */
async function provisionAuthRole(sql: ReturnType<typeof postgres>): Promise<void> {
  const password = process.env.AUTH_DB_PASSWORD;
  if (!password || !password.trim()) {
    console.log('  (skipped: AUTH_DB_PASSWORD not set)');
    return;
  }
  try {
    // The password is passed as a quoted literal, not interpolated raw: it is
    // a secret from the environment, and a stray quote would be a syntax error
    // at best.
    const quoted = `'${password.replace(/'/g, "''")}'`;
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${AUTH_ROLE}') THEN
          -- %L, not %s: %s interpolates raw, so PASSWORD hunter2 is a syntax
          -- error and PASSWORD o'brien would be an injection.
          EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${AUTH_ROLE}', ${quoted});
        ELSE
          EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', '${AUTH_ROLE}', ${quoted});
        END IF;
      END $$;`);
    // ASSERT the attributes, do not command them.
    //
    // CREATE ROLE already defaults to NOSUPERUSER and NOBYPASSRLS, and on a
    // managed Postgres the owner is not a superuser, so it cannot set those
    // attributes even to the values they already hold. Issuing the ALTER threw
    // "permission denied to alter role" in production -- and because it threw,
    // the GRANTs after it never ran and the role existed with no privileges at
    // all. The check below is what actually matters; the command was only ever
    // restating a default.
    try {
      await sql.unsafe(`ALTER ROLE ${AUTH_ROLE} NOCREATEDB NOCREATEROLE`);
    } catch {
      // Unavailable on managed Postgres. The assertion below still runs.
    }
    await sql.unsafe(`GRANT app_auth TO ${AUTH_ROLE}`);
    const [db] = await sql<{ current_database: string }[]>`SELECT current_database()`;
    await sql.unsafe(`GRANT CONNECT ON DATABASE "${db!.current_database}" TO ${AUTH_ROLE}`);

    // Stated, not assumed: a role that bypasses RLS would defeat the point.
    const [check] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${AUTH_ROLE}`;
    if (check?.rolsuper || check?.rolbypassrls) {
      throw new Error(`${AUTH_ROLE} can bypass RLS`);
    }
    console.log(`  ✓ ${AUTH_ROLE} ready (member of app_auth, nobypassrls)`);
  } catch (e) {
    console.warn(`  ! could not provision ${AUTH_ROLE}: ${e instanceof Error ? e.message : e}`);
    console.warn('    Authentication will fall back to the application connection.');
  }
}

async function main(): Promise<void> {
  console.log(`db-migrate: applying to ${describeUrl(url)} (via ${urlVarName})`);

  console.log('1. bootstrap');
  await runFile('drizzle/sql/00-bootstrap.sql', '00-bootstrap.sql');

  console.log('2. tables (drizzle migrations)');
  const dir = 'drizzle/migrations';
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    : [];
  if (files.length === 0) {
    console.log('  (none — run `pnpm db:generate` first)');
  } else {
    await sql`CREATE TABLE IF NOT EXISTS core.__migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    for (const f of files) {
      const [done] = await sql`SELECT 1 FROM core.__migrations WHERE name = ${f}`;
      if (done) {
        console.log(`  · ${f} (already applied)`);
        continue;
      }
      // drizzle-kit separates statements with this marker.
      //
      // It also emits bare `CREATE SCHEMA "x";`, which collides with bootstrap —
      // bootstrap has to create the schemas first because core.uuid_generate_v7()
      // lives in one and every table defaults to it. Making that single statement
      // form idempotent is the smallest correct fix.
      const body = readFileSync(join(dir, f), 'utf8').replace(
        /CREATE SCHEMA "/g,
        'CREATE SCHEMA IF NOT EXISTS "',
      );
      // One transaction per file: a migration either fully applies or not at all,
      // and the bookkeeping row commits with it.
      await sql.begin(async (tx) => {
        for (const stmt of body.split('--> statement-breakpoint')) {
          if (stmt.trim()) await tx.unsafe(stmt);
        }
        await tx`INSERT INTO core.__migrations (name) VALUES (${f})`;
      });
      console.log(`  ✓ ${f}`);
    }
  }

  console.log('3. ontology constraints (generated)');
  await runFile('drizzle/generated/ontology.sql', 'ontology.sql');

  console.log('4-7. functions, views, matviews, rls, roles');
  for (const f of [
    '10-functions.sql',
    '20-views.sql',
    '50-matviews.sql',
    '30-rls.sql',
    '40-roles.sql',
  ]) {
    await runFile(join('drizzle/sql', f), f);
  }

  // After 40-roles.sql, which is what creates app_auth in the first place.
  console.log('8. authentication login role');
  await provisionAuthRole(sql);

  const rows = await sql<
    { count: number }[]
  >`SELECT count(*)::int AS count FROM core.predicate_meta`;
  console.log(`\ndb-migrate: done. ${rows[0]?.count ?? 0} predicates registered in the database.`);
  await sql.end();
}

main().catch(async (e) => {
  console.error('\ndb-migrate FAILED:', e instanceof Error ? e.message : e);
  await sql.end();
  process.exit(1);
});
