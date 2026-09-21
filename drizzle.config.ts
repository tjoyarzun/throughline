import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./drizzle/schema/raw.ts', './drizzle/schema/core.ts', './drizzle/schema/usr.ts'],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  // DDL and advisory locks are unreliable through a connection pooler, so
  // migrations always use the direct connection. See docs/deployment.md.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '' },
  schemaFilter: ['raw', 'core', 'usr'],
  verbose: true,
  strict: true,
});
