/**
 * Runs Wikidata enrichment against the local database.
 *
 * The enrichment itself lives in src/server/ingest/enrich-wikidata.ts, because
 * it must also run as a job in production. This script is the local front end
 * and does the whole corpus in one pass; the job does it in windows.
 *
 * Idempotent. Usage: pnpm enrich:wikidata [--limit N]
 */
import postgres from 'postgres';
import { enrichWikidata } from '@/server/ingest/enrich-wikidata';

const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? Number(args[li + 1]) : Infinity;

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });

async function main(): Promise<void> {
  const s = await enrichWikidata(sql, {
    maxTitles: LIMIT,
    onProgress: (done, total, st) => {
      if (done % 600 < 60) {
        console.log(
          `  ${done}/${total} · works ${st.works} based_on ${st.basedOn} franchises ${st.franchises}`,
        );
      }
    },
  });

  console.log('\nenrichment complete');
  console.log(`  works created        ${s.works}`);
  console.log(`  based_on edges       ${s.basedOn}`);
  console.log(`  franchise edges      ${s.franchises}`);
  console.log(`  influenced_by edges  ${s.influences}`);
  console.log(`  series REJECTED as not-a-franchise (lists, award sets): ${s.rejectedSeries}`);
  console.log(
    `  sources SKIPPED as screen works (title-to-title, not a work): ${s.skippedScreenWork}`,
  );
  console.log(
    `  sources SKIPPED as an unrecognized type (never guessed):      ${s.skippedUnknownKind}`,
  );
  await sql.end();
}

main().catch(async (e) => {
  console.error('enrich-wikidata FAILED:', e);
  await sql.end();
  process.exit(1);
});
