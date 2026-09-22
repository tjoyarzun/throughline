/**
 * Resolves a database URL across the several names Neon's Vercel integration
 * may use.
 *
 * Depending on how the integration was attached, the direct (non-pooled)
 * connection appears as DATABASE_URL_UNPOOLED or POSTGRES_URL_NON_POOLING, and
 * the pooled one as DATABASE_URL or POSTGRES_URL. Hard-coding one name means a
 * migration silently runs through the pooler, where DDL and advisory locks are
 * unreliable.
 */

const DIRECT = [
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL_NO_SSL',
] as const;
const POOLED = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL'] as const;

function firstSet(names: readonly string[]): { name: string; url: string } | null {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return { name: n, url: v };
  }
  return null;
}

/** For migrations, DDL and the seed. Never serves a request. */
export function directDatabaseUrl(): { name: string; url: string } | null {
  return firstSet(DIRECT) ?? firstSet(POOLED);
}

/** For the application. Pooled is correct here. */
export function pooledDatabaseUrl(): { name: string; url: string } | null {
  return firstSet(POOLED) ?? firstSet(DIRECT);
}

/** Host only — safe to log, unlike the URL itself. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return '<unparsable>';
  }
}

/** The login role that carries the app_auth grants. */
export const AUTH_ROLE = 'throughline_auth';

/**
 * The connection authentication uses.
 *
 * DERIVED from the pooled URL rather than configured separately. A second
 * connection string would be the same host, database and parameters as the
 * first with two fields changed -- and two copies of one fact drift. Rotate
 * the database and you would have to remember both; forget, and auth keeps
 * talking to the old one.
 *
 * So production sets ONE secret, AUTH_DB_PASSWORD, and this swaps the
 * credentials on the URL that already exists. An explicit AUTH_DATABASE_URL
 * still wins when someone genuinely needs a different host.
 *
 * Returns null when neither is configured, which the caller must treat as a
 * problem in production rather than a default.
 */
export function authDatabaseUrl(): { name: string; url: string } | null {
  const explicit = process.env.AUTH_DATABASE_URL;
  if (explicit && explicit.trim()) return { name: 'AUTH_DATABASE_URL', url: explicit };

  const password = process.env.AUTH_DB_PASSWORD;
  const base = pooledDatabaseUrl();
  if (!password || !password.trim() || !base) return null;

  try {
    const u = new URL(base.url);
    u.username = AUTH_ROLE;
    u.password = password;
    return { name: 'derived from AUTH_DB_PASSWORD', url: u.toString() };
  } catch {
    return null;
  }
}
