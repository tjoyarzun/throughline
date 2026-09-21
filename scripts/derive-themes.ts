/**
 * Runs theme derivation against the local database and prints coverage.
 *
 * The derivation itself lives in src/server/ingest/derive-themes.ts, because it
 * must also run as a job handler in production, where a Vercel function is the
 * only thing that can reach the database. This script is the local front end.
 *
 * Usage: pnpm derive:themes
 */
import postgres from 'postgres';
import { deriveThemes, themeCoverage } from '@/server/ingest/derive-themes';

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });

async function main(): Promise<void> {
  const r = await deriveThemes(sql);
  console.log(`themes      ${r.themes}`);
  console.log(`crosswalk   ${r.pairs} keyword-theme pairs, ${r.exclusions} exclusions`);
  console.log(`edges       ${r.edges} explores_theme`);

  const c = await themeCoverage(sql);
  const pct = (a: number, b: number) => (b === 0 ? '0.0' : ((100 * a) / b).toFixed(1));
  console.log('\ncoverage');
  console.log(
    `  THEMED, of titles that have keywords   ${c.themed}/${c.with_keywords}  (${pct(c.themed, c.with_keywords)}%)   <- the number that matters`,
  );
  console.log(
    `  titles with no TMDB keywords at all    ${c.no_keywords}/${c.titles}  (${pct(c.no_keywords, c.titles)}%)   <- hard ceiling, not a crosswalk gap`,
  );
  console.log(
    `  themed, of ALL titles                  ${c.themed}/${c.titles}  (${pct(c.themed, c.titles)}%)`,
  );
  console.log('');
  console.log(
    `  keyword assignments mapped             ${c.mapped_assignments}/${c.assignments}  (${pct(c.mapped_assignments, c.assignments)}%)`,
  );
  console.log(
    `  ... plus deliberately excluded         ${c.excluded_assignments}  (${pct(c.mapped_assignments + c.excluded_assignments, c.assignments)}% adjudicated)`,
  );
  console.log(
    `  distinct keywords mapped               ${c.mapped_keywords}/${c.distinct_keywords}  (${pct(c.mapped_keywords, c.distinct_keywords)}%)`,
  );
  console.log('');
  console.log('  Distinct-keyword coverage is low BY DESIGN: the tail is thousands of');
  console.log('  terms used once each, overwhelmingly settings and objects. Assignment');
  console.log('  coverage weights by how often a keyword is actually used, and');
  console.log('  "adjudicated" counts terms we considered and deliberately excluded —');
  console.log('  which is different information from never having looked at them.');

  await sql.end();
}

main().catch(async (e) => {
  console.error('derive-themes FAILED:', e);
  await sql.end();
  process.exit(1);
});
