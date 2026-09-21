import { pgSchema, text, jsonb, timestamp, integer, index, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Verbatim provider payloads. NEVER read by application code.
 *
 * Exists for two concrete reasons, not purism:
 *  1. Replayability — when the keyword-to-theme crosswalk changes (and it will,
 *     repeatedly), we re-derive themes for the whole corpus from here instead of
 *     re-crawling TMDB.
 *  2. Debuggability — "why is this director wrong?" is answered by diffing the
 *     stored payload against core.
 *
 * See docs/adr/0001-postgres-four-schema-separation.md.
 */
export const rawSchema = pgSchema('raw');

export const tmdbPayload = rawSchema.table(
  'tmdb_payload',
  {
    /** e.g. 'movie', 'tv', 'person', 'tv_season', 'tv_episode' */
    resource: text('resource').notNull(),
    /** TMDB's own id, as text so every resource shares one shape. */
    sourceId: text('source_id').notNull(),
    /** Which append_to_response set this payload was fetched with. */
    variant: text('variant').notNull().default('default'),
    payload: jsonb('payload').notNull(),
    etag: text('etag'),
    httpStatus: integer('http_status').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set by housekeeping after 90d: payload reduced to consumed fields. */
    prunedAt: timestamp('pruned_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.resource, t.sourceId, t.variant] }),
    index('raw_tmdb_fetched_idx').on(t.fetchedAt),
  ],
);

export const wikidataPayload = rawSchema.table(
  'wikidata_payload',
  {
    qid: text('qid').primaryKey(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('raw_wikidata_fetched_idx').on(t.fetchedAt)],
);
