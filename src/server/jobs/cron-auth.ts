import { timingSafeEqual } from 'node:crypto';

/**
 * Shared cron authorization. Constant-time — a timing oracle on a cron secret
 * is cheap to avoid, and there are now three endpoints that need it.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(request.headers.get('authorization') ?? '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function databaseUrl(): string | null {
  return process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? null;
}
