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

// Only compare against vars we actually own; the shell is full of unrelated ones.
const OWNED_PREFIXES = ['DATABASE_', 'BETTER_AUTH_', 'TMDB_', 'CRON_', 'UPSTASH_', 'NEXT_PUBLIC_'];
const present = new Set(
  Object.keys(process.env).filter((k) => OWNED_PREFIXES.some((p) => k.startsWith(p))),
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
