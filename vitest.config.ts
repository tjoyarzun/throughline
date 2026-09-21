import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/{unit,ontology,authz,integration}/**/*.test.ts'],
    reporters: ['default'],
    setupFiles: ['./tests/setup.ts'],
    /**
     * Database suites share ONE Postgres, and the idempotency suite truncates
     * core.* to get a clean slate. Run files sequentially so one suite cannot
     * delete another's fixtures mid-run. The whole suite is ~2s; the parallelism
     * is not worth the flakiness, and a flaky authorization test is worse than
     * a slow one.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~ontology': fileURLToPath(new URL('./ontology', import.meta.url)),
    },
  },
});
