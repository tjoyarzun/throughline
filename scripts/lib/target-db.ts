/**
 * Which database a script is about to write to.
 *
 * Scripts in here are operated by hand against a database chosen at the
 * moment of running: local one minute, Neon the next. That makes the target a
 * decision, and a decision made from ambient shell state is not a decision.
 *
 * The failure this exists to prevent already happened. A hydrate run was
 * launched with DATABASE_URL set inline to a Neon connection string, and the
 * script wrote 59,809 rows to localhost, because a DATABASE_URL_UNPOOLED left
 * exported in that shell from some earlier command took precedence. The
 * script DID print `database : localhost:5432` on its first line -- and a
 * correct-looking progress bar then ran for forty minutes over the top of it.
 * A line you have to notice is not a safeguard.
 *
 * So: an explicit --url wins outright, and if the environment offers two
 * candidates that disagree, the script stops and makes the operator say which.
 * Ambiguity is an error, not something to resolve by ranking.
 */

/** Direct connection first: bulk writers and DDL want to bypass the pooler. */
const CANDIDATES = ['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'DATABASE_URL'] as const;

export interface Target {
  url: string;
  /** Host and database, safe to print -- never the credentials. */
  label: string;
  /** Where it came from, so the log says how the choice was made. */
  source: string;
}

/**
 * Neon publishes the pooled and direct endpoints under different hostnames --
 * `ep-foo-pooler.region.neon.tech` and `ep-foo.region.neon.tech` -- so two
 * variables pointing at ONE database legitimately differ by a hostname. That
 * is the pair we must not flag. Normalizing the pooler suffix away leaves a
 * comparison that still catches the case that matters: localhost against
 * anything else.
 */
function identity(url: string): string {
  const u = new URL(url);
  const host = u.host.replace(/^([^.]+)-pooler\./, '$1.');
  return `${host}${u.pathname}`;
}

function describe(url: string): string {
  const u = new URL(url);
  return `${u.host}${u.pathname}`;
}

export function targetDatabase(script: string): Target {
  const flag = process.argv.indexOf('--url');
  if (flag !== -1) {
    const value = process.argv[flag + 1];
    if (!value) throw new Error(`${script}: --url needs a connection string after it`);
    return { url: value, label: describe(value), source: '--url' };
  }

  const found: { name: string; url: string }[] = [];
  for (const name of CANDIDATES) {
    const url = process.env[name];
    if (url) found.push({ name, url });
  }

  if (found.length === 0) {
    throw new Error(
      `${script}: no database to write to. Set DATABASE_URL, or pass --url '<connection string>'.`,
    );
  }

  const distinct = new Map(found.map((c) => [identity(c.url), c]));
  if (distinct.size > 1) {
    const listed = found.map((c) => `  ${c.name} -> ${describe(c.url)}`).join('\n');
    throw new Error(
      `${script}: the environment names ${distinct.size} different databases and this script ` +
        `will not guess between them.\n${listed}\n` +
        `Pass --url '<connection string>' to say which, or unset the one you did not mean. ` +
        `A variable left exported in a shell has silently won this argument before.`,
    );
  }

  const chosen = found[0]!;
  return { url: chosen.url, label: describe(chosen.url), source: chosen.name };
}
