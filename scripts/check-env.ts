/**
 * Config drift guard: the set of env var NAMES in the environment must match
 * .env.example exactly. Missing vars break the app; *extra* vars are how dead
 * config accumulates. Both fail. See docs/deployment.md.
 */
import { readFileSync } from 'node:fs';

const declared = new Set(
  readFileSync('.env.example', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('=')[0]!.trim()),
);

// Only compare against vars we actually own; the shell is full of unrelated
// ones. The namespaces are DERIVED from .env.example rather than hardcoded: a
// hand-maintained prefix list drifts from the file, and any declared var
// outside it then reports as "missing" forever even when it is set. That is
// how this check came to report AUTH_DATABASE_URL, RESEND_API_KEY and
// EMAIL_FROM as missing while all three were populated. NEXT_ is the one
// exception -- the framework owns that namespace, and only NEXT_PUBLIC_ is ours.
const namespaces = [
  ...new Set(
    [...declared].map((k) => (k.startsWith('NEXT_') ? 'NEXT_PUBLIC_' : `${k.split('_')[0]}_`)),
  ),
];
const present = new Set(
  Object.keys(process.env).filter((k) => namespaces.some((p) => k.startsWith(p))),
);

const missing = [...declared].filter((k) => !present.has(k));
const extra = [...present].filter((k) => !declared.has(k));

if (missing.length === 0 && extra.length === 0) {
  console.log(`check-env: OK — ${declared.size} declared vars all present, no strays`);
  process.exit(0);
}
if (missing.length)
  console.error(`check-env: missing (declared but not set): ${missing.join(', ')}`);
if (extra.length)
  console.error(`check-env: unexpected (set but not declared): ${extra.join(', ')}`);
console.error('\nUpdate .env.example or the environment so the two agree.');
process.exit(1);
