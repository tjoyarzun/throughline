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
import { directDatabaseUrl, describeUrl } from '@/server/db/resolve-url';

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
