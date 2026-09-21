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
