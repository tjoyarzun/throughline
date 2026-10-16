/**
 * Point every database test at the TEST database, never the development one.
 *
 * Locally, DATABASE_URL is a dev database holding the seeded corpus — thousands
 * of real titles including The Office and Blade Runner 2049. Entity-resolution
 * fixtures collide with those instantly, and the failures look like resolver
 * bugs rather than what they are. In CI, DATABASE_URL already points at a
 * throwaway Postgres service, so this override is a no-op there.
 *
 * This mirrors the production setup: a Neon branch per pull request.
 */
const testUrl = process.env.TEST_ADMIN_DATABASE_URL;
if (testUrl) {
  process.env.DATABASE_URL = testUrl;
  process.env.DATABASE_URL_UNPOOLED = testUrl;
}

/**
 * And refuse anything else, rather than trusting the override above.
 *
 * The override only fires when TEST_ADMIN_DATABASE_URL is set. On 2026-10-16
 * a run that had DATABASE_URL but not that variable went straight at the dev
 * database, and idempotency.test.ts -- which TRUNCATEs core.title and friends
 * CASCADE -- erased the ~4,600-title local corpus without a single failure.
 * Every database this suite may touch is named *_test, locally and in CI.
 */
for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'] as const) {
  const url = process.env[name];
  if (url && !new URL(url).pathname.endsWith('_test')) {
    throw new Error(
      `tests/setup: ${name} points at "${new URL(url).pathname.slice(1)}", not a *_test ` +
        'database. Tests truncate tables; set TEST_ADMIN_DATABASE_URL or unset DATABASE_URL.',
    );
  }
}
