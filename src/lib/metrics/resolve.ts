import postgres from 'postgres';
import { pooledDatabaseUrl } from '@/server/db/resolve-url';
import { METRICS, type MetricDef, type MetricName } from '@/lib/ontology/metrics';

/**
 * Compiles a metric DEFINITION into account-scoped SQL and runs it.
 *
 * A metric is a line of YAML, not SQL inside a React component. Adding one is
 * an entry in metrics.yaml plus a chart binding; nothing here changes.
 *
 * DELIBERATE CEILING: six transforms, no joins, no expression language. If a
 * metric needs something outside this vocabulary that is a signal to write a
 * view in sem.*, not to grow the resolver. Half-built dbt is the failure mode
 * this scope limit exists to prevent. See docs/semantic-layer.md.
 *
 * ON SQL SAFETY: source, filter, measure and dimension are interpolated, not
 * parameterized -- they are identifiers and expressions, which parameters
 * cannot carry. They come only from metrics.yaml, a committed file that is
 * compiled and drift-checked; no request value ever reaches them. The account
 * id, which IS a request value, is always a bound parameter.
 */

const resolved = pooledDatabaseUrl();
const sql = resolved
  ? postgres(resolved.url, { max: 4, prepare: false, idle_timeout: 20, onnotice: () => {} })
  : null;

export interface MetricRow {
  key: string;
  label: string | null;
  value: number;
  secondary: number | null;
  /** Share of the total, for transforms that compute one. */
  share: number | null;
}

export interface MetricResult {
  name: string;
  label: string;
  description: string;
  viz: string;
  rows: MetricRow[];
}

/**
 * metrics.yaml is written in the vocabulary of the metric, not of Postgres.
 * `count_distinct(x)` reads better in a definition than `count(DISTINCT x)`
 * and is the form the spec uses, so the resolver translates it rather than
 * making every definition carry SQL syntax.
 */
function normalizeMeasure(measure: string): string {
  return measure.replace(/count_distinct\(([^)]+)\)/g, 'count(DISTINCT $1)');
}

/** Guards against a definition naming a relation outside the semantic layer. */
function assertSemanticSource(def: MetricDef): void {
  if (!def.source.startsWith('sem.')) {
    throw new Error(`metric source must live in sem.*, got "${def.source}"`);
  }
}

export async function resolveMetric(
  name: MetricName,
  accountId: string,
  opts: { limit?: number } = {},
): Promise<MetricResult> {
  const def = METRICS[name];
  if (!def) throw new Error(`unknown metric "${name}"`);
  if (!sql) throw new Error('metrics: no database configured');
  assertSemanticSource(def);

  const where = ['account_id = $1', def.filter].filter(Boolean).join(' AND ');
  const limit = opts.limit ?? def.limit ?? 50;

  // `key` is what the row is grouped by; `label` is what a person reads.
  const dimension = def.dimension ?? 'label';
  const measure = normalizeMeasure(def.measure);
  // Aggregated for the grouping transforms; raw for `rate`, which sums it
  // itself. Left raw everywhere it would nest one aggregate inside another.
  const secondaryAgg = def.secondaryMeasure ? `avg(${def.secondaryMeasure})` : 'NULL';
  const secondaryRaw = def.secondaryMeasure ?? 'NULL';

  // A metric whose grain is the account alone is a single number, not a
  // grouped list -- completion_rate is one share, not one share per anything.
  // Grouping it by a dimension it never declared is what made it fall back to
  // `label` and fail.
  const isScalar = !def.dimension && def.grain.filter((g) => g !== 'account_id').length === 0;

  let query: string;
  if (isScalar) {
    query = `
      SELECT 'total'::text AS key, NULL::text AS label,
             (${measure})::numeric AS value, ${secondaryAgg}::numeric AS secondary,
             NULL::numeric AS share
      FROM ${def.source} WHERE ${where}`;
  } else
    switch (def.transform) {
      case 'share_of_total':
        query = `
        WITH base AS (
          SELECT ${dimension}::text AS key, label,
                 sum(${measure})::numeric AS value, ${secondaryAgg}::numeric AS secondary
          FROM ${def.source} WHERE ${where}
          GROUP BY 1, 2
        )
        SELECT key, label, value, secondary,
               round(value / nullif(sum(value) OVER (), 0), 4) AS share
        FROM base ORDER BY value DESC LIMIT ${limit}`;
        break;

      case 'rank':
        query = `
        SELECT ${dimension}::text AS key, label,
               sum(${measure})::numeric AS value, ${secondaryAgg}::numeric AS secondary,
               NULL::numeric AS share
        FROM ${def.source} WHERE ${where}
        GROUP BY 1, 2
        ORDER BY value ${def.ascending ? 'ASC' : 'DESC'} LIMIT ${limit}`;
        break;

      case 'bucket':
      case 'time_series':
      case 'none':
        query = `
        SELECT ${dimension}::text AS key, NULL::text AS label,
               (${measure})::numeric AS value, ${secondaryAgg}::numeric AS secondary,
               NULL::numeric AS share
        FROM ${def.source} WHERE ${where}
        GROUP BY 1
        ORDER BY 1 ASC LIMIT ${limit}`;
        break;

      case 'rate':
        query = `
        SELECT ${dimension}::text AS key, label,
               (sum(${measure})::numeric / nullif(sum(${secondaryRaw}), 0)) AS value,
               sum(${secondaryRaw})::numeric AS secondary,
               NULL::numeric AS share
        FROM ${def.source} WHERE ${where}
        GROUP BY 1, 2
        ORDER BY value DESC LIMIT ${limit}`;
        break;

      default: {
        // Exhaustive: a transform added to the YAML without a branch here fails
        // to compile rather than silently returning nothing.
        const never: never = def.transform;
        throw new Error(`unsupported transform "${String(never)}"`);
      }
    }

  const rows = await sql.unsafe<
    {
      key: string;
      label: string | null;
      value: string;
      secondary: string | null;
      share: string | null;
    }[]
  >(query, [accountId]);

  return {
    name,
    label: def.label,
    description: def.description,
    viz: def.viz,
    rows: rows.map((r) => ({
      key: r.key,
      label: r.label,
      value: Number(r.value),
      secondary: r.secondary === null ? null : Number(r.secondary),
      share: r.share === null ? null : Number(r.share),
    })),
  };
}

/** The metrics due in this phase, in display order. */
export const PHASE_1_METRICS: MetricName[] = [
  'genre_distribution',
  'top_directors',
  'rating_distribution',
  'viewing_over_time',
  'watchlist_aging',
];
