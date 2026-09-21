import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

/**
 * Two connections, on purpose.
 *
 *   globalDb  core.* and sem.* reads. No RLS involved, no transaction needed.
 *   withUser  every usr.* access. Opens a REAL transaction and sets the account
 *             id with SET LOCAL.
 *
 * Why withUser() is not optional — two independent reasons, either of which is
 * sufficient (see docs/security.md):
 *
 *   1. SET LOCAL only persists inside a transaction. Neon's HTTP driver runs each
 *      query as its own implicit transaction, so a SET LOCAL issued separately
 *      evaporates and the RLS policies return ZERO ROWS. Silently.
 *   2. DATABASE_URL is pgbouncer in transaction mode. A backend connection goes
 *      to a different request the moment a transaction ends. SET LOCAL is
 *      transaction-scoped and safe; a plain SET would persist on that backend and
 *      be inherited by the next request that borrows it — a cross-tenant leak
 *      that would pass every test written against a single user.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  prepare: false, // pgbouncer transaction mode does not support named prepared statements
});

/** Global reads. Never use this for anything under usr.*. */
export const globalDb = drizzle(client);

export type Tx = Parameters<Parameters<typeof globalDb.transaction>[0]>[0];

/**
 * The ONLY path to user data.
 *
 * @param accountId the authenticated account, from auth() at the call site
 */
export async function withUser<T>(accountId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!accountId) throw new Error('withUser: accountId is required');
  return globalDb.transaction(async (tx) => {
    // set_config(..., true) is the parameterized equivalent of SET LOCAL:
    // transaction-scoped, and not vulnerable to injection the way an
    // interpolated SET LOCAL would be.
    await tx.execute(sql`select set_config('app.account_id', ${accountId}, true)`);
    return fn(tx);
  });
}

/** Ingest and maintenance only. Never in a request path. */
export function directClient() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? connectionString!;
  return postgres(url, { max: 1 });
}

export async function closeDb(): Promise<void> {
  await client.end();
}
