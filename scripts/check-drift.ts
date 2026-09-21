/**
 * Asserts the generated artifacts on disk match what ontology/ontology.yaml
 * produces right now.
 *
 * The naive version of this check diffed against HEAD, which conflates two very
 * different things: "you forgot to run codegen" (a real problem) and "you have
 * uncommitted work" (normal). It made `pnpm verify` unusable mid-change.
 *
 * This hashes the artifacts, re-runs codegen, and compares. It is independent of
 * git state, so it means the same thing in a dirty working tree and in a clean
 * CI checkout: the committed artifacts are stale, or someone hand-edited one.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ARTIFACTS = [
  'src/lib/ontology/generated.ts',
  'drizzle/generated/ontology.sql',
  'docs/ontology-reference.md',
];

const hash = (p: string): string =>
  existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'missing';

const before = Object.fromEntries(ARTIFACTS.map((p) => [p, hash(p)]));
execFileSync('pnpm', ['exec', 'tsx', 'ontology/codegen.ts'], { stdio: 'pipe' });
const after = Object.fromEntries(ARTIFACTS.map((p) => [p, hash(p)]));

const stale = ARTIFACTS.filter((p) => before[p] !== after[p]);
if (stale.length > 0) {
  console.error('check-drift: FAIL — generated artifacts were out of date:\n');
  for (const p of stale) console.error(`  ${p}`);
  console.error('\nThey have just been regenerated. Review and commit them.');
  console.error('If you hand-edited one: do not. Edit ontology/ontology.yaml.');
  process.exit(1);
}
console.log(`check-drift: OK — ${ARTIFACTS.length} artifacts match ontology.yaml`);
