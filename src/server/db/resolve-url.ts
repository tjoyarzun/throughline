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
