/**
 * Runs similarity derivation against the local database.
 *
 * The derivation lives in src/server/ingest/derive-similar.ts because it must
 * also run as the recompute_similar job in production.
 *
 * Usage: pnpm derive:similar
 */
import postgres from 'postgres';
import { deriveSimilar } from '@/server/ingest/derive-similar';

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });

const started = Date.now();
const r = await deriveSimilar(sql);
console.log(`similar_to: ${r.edges} edges over ${r.pairs} titles in ${Date.now() - started}ms`);

const breakdown = await sql<{ reason: string; n: number }[]>`
  SELECT attributes->>'reason' AS reason, count(*)::int AS n
  FROM core.edge_derived WHERE predicate = 'similar_to'
  GROUP BY 1 ORDER BY 2 DESC`;
for (const b of breakdown) console.log(`  ${b.reason.padEnd(10)} ${b.n}`);
await sql.end();
