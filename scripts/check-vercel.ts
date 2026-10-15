/**
 * Validates vercel.json before it reaches Vercel.
 *
 * Two deployment failures came from this file and neither produced a useful
 * local signal — `pnpm build` passes and the error only appears in Vercel's
 * build log:
 *
 *   1. Cron paths pointing at routes that do not exist.
 *   2. Sub-daily cron schedules, which Vercel rejects outright on the Hobby
 *      plan: "Hobby accounts are limited to daily Cron Jobs."
 *
 * Both are trivially checkable here.
 */
import { readFileSync, existsSync } from 'node:fs';

interface VercelConfig {
  crons?: { path: string; schedule: string }[];
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig;
/**
 * The plan is a fact about the project, so the default states it rather than
 * every caller having to. It was 'pro' from 2026-10-11 to 2026-10-15, while
 * refresh-stale ran hourly to pull the corpus from 36% fresh back to 100%.
 * That is done, the schedule is daily again, and the account goes back to
 * Hobby -- so this does too.
 *
 * IF THE PROJECT EVER GOES BACK TO HOBBY: change this to 'hobby' and make
 * every cron daily again, or Vercel rejects the deployment with "Hobby
 * accounts are limited to daily Cron Jobs" -- which is the failure this whole
 * script exists to catch locally instead of in a build log.
 */
const plan = process.env.VERCEL_PLAN ?? 'hobby';
const problems: string[] = [];

/**
 * A schedule fires at most once a day only when neither the minute nor the
 * hour field is a wildcard, step or list. `0 4 * * *` is daily; `0 * * * *`
 * is hourly and fails on Hobby.
 */
function isDaily(schedule: string): boolean {
  const [minute, hour] = schedule.trim().split(/\s+/);
  if (!minute || !hour) return false;
  const single = (f: string) => /^\d+$/.test(f);
  return single(minute) && single(hour);
}

for (const cron of config.crons ?? []) {
  const routeFile = `src/app${cron.path}/route.ts`;
  if (!existsSync(routeFile)) {
    problems.push(`${cron.path} has no route at ${routeFile} — the deployment will fail`);
  }
  if (plan === 'hobby' && !isDaily(cron.schedule)) {
    problems.push(
      `${cron.path} runs "${cron.schedule}", more often than daily. ` +
        'Vercel rejects this on Hobby: "Hobby accounts are limited to daily Cron Jobs." ' +
        'Set VERCEL_PLAN=pro once the project is upgraded.',
    );
  }
}

if (problems.length > 0) {
  console.error(`check-vercel: FAIL (${plan} plan)\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  `check-vercel: OK — ${config.crons?.length ?? 0} cron(s), all routed and ${plan}-compatible`,
);
