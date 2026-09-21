/**
 * Fails if any test was skipped.
 *
 * A suite that silently skips is worse than one that fails: it reports green
 * while proving nothing. The database suites here guard against exactly the two
 * failures that matter most — cross-tenant data access and an unenforced
 * ontology — and they skip when DATABASE_URL is unset. In CI that must be an
 * error, not a shrug.
 *
 * Run: pnpm test:strict
 */
import { readFileSync, existsSync } from 'node:fs';

const path = process.argv[2] ?? '.vitest/json/output.json';
if (!existsSync(path)) {
  console.error(`assert-no-skips: no report at ${path} — did vitest run?`);
  process.exit(1);
}

type Assertion = { status: string; fullName: string };
const report = JSON.parse(readFileSync(path, 'utf8')) as {
  testResults: { assertionResults: Assertion[] }[];
};

const all = report.testResults.flatMap((f) => f.assertionResults);
const skipped = all.filter((a) => a.status === 'pending' || a.status === 'skipped');

if (skipped.length > 0) {
  console.error(`assert-no-skips: FAIL — ${skipped.length} of ${all.length} tests were skipped:\n`);
  for (const s of skipped.slice(0, 10)) console.error(`  ${s.fullName}`);
  if (skipped.length > 10) console.error(`  ... and ${skipped.length - 10} more`);
  console.error('\nUsually DATABASE_URL or TEST_DATABASE_URL is unset.');
  process.exit(1);
}
console.log(`assert-no-skips: OK — all ${all.length} tests executed`);
