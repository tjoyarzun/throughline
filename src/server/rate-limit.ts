import { sql } from 'drizzle-orm';
import { globalDb } from './db/client';

/**
 * Rate limiting.
 *
 * The counter and the sliding-window math live in core.rate_limit_hit; this
 * is the calling convention and, more importantly, the policy for what to do
 * when the limiter itself is broken.
 */

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

/**
 * Fail-open or fail-closed is the whole decision, and it differs per surface.
 *
 *   fail-closed on authentication. If the limiter is down, an attacker gets
 *   unlimited attempts at a six-digit code, which is the one place here where
 *   unlimited attempts actually wins something. Refusing sign-in during a
 *   database outage costs nothing extra -- sign-in needs the database anyway.
 *
 *   fail-open everywhere else. The limiter exists to protect TMDB's quota and
 *   our own CPU, not to protect a secret. Turning a database hiccup into a
 *   dead search box is a worse outcome than briefly unbounded searching.
 */
export async function rateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
  opts: { failClosed?: boolean } = {},
): Promise<LimitResult> {
  try {
    const rows = (await globalDb.execute(
      sql`SELECT allowed, remaining, retry_after_s
          FROM core.rate_limit_hit(${bucket}, ${limit}::int,
                                   make_interval(secs => ${windowSeconds}::int))`,
    )) as unknown as { allowed: boolean; remaining: number; retry_after_s: number }[];

    const r = rows[0];
    if (!r) throw new Error('rate_limit_hit returned no row');
    return { allowed: r.allowed, remaining: r.remaining, retryAfter: r.retry_after_s };
  } catch (e) {
    console.error('rateLimit: limiter unavailable', { bucket, error: String(e) });
    if (opts.failClosed) return { allowed: false, remaining: 0, retryAfter: 60 };
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}

/**
 * The shape Better Auth's `customStorage.consume` expects, over the same
 * counter everything else uses.
 *
 * Fail-CLOSED, unlike the default: this is the authentication path, and it is
 * the one place where a limiter outage handing out unlimited attempts at a
 * six-digit code actually wins an attacker something. Refusing sign-in during
 * a database outage costs nothing, because sign-in needs the database anyway.
 */
export async function rateLimitConsume(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<LimitResult> {
  return rateLimit(key, max, windowSeconds, { failClosed: true });
}
