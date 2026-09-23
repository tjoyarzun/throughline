import {
  pgSchema,
  text,
  integer,
  smallint,
  boolean,
  date,
  timestamp,
  jsonb,
  numeric,
  bigint,
  char,
  uuid,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, updatedAt } from './_shared';

/**
 * Canonical entities and the ontology graph. Written by ingest and curation only —
 * the application role has SELECT and nothing more.
 *
 * Predicate CHECK constraints and the domain/range trigger are NOT declared here.
 * They are generated from ontology/ontology.yaml into drizzle/generated/ontology.sql
 * and applied after these tables. That is the point: the database enforces the
 * ontology, and the ontology is the source of truth for what it enforces.
 */
export const core = pgSchema('core');

const pk = () =>
  uuid('id')
    .primaryKey()
    .default(sql`core.uuid_generate_v7()`);

// ── Node tables ──────────────────────────────────────────────────────────────

export const title = core.table(
  'title',
  {
    id: pk(),
    slug: text('slug').notNull().unique(),
    /** 'movie' | 'show'. Unified deliberately: they share ~90% of attributes and
     *  100% of their edges. See docs/adr/0002. */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    originalTitle: text('original_title'),
    /** Normalized for entity resolution blocking + fuzzy match. See docs/data-model.md. */
    sortTitle: text('sort_title').notNull(),
    releaseDate: date('release_date'),
    endDate: date('end_date'),
    runtimeMinutes: integer('runtime_minutes'),
    status: text('status'),
    overview: text('overview'),
    originalLanguage: char('original_language', { length: 2 }),
    certification: text('certification'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    /** Dominant chroma-weighted poster color, clamped for contrast. Never used for text. */
    accentColor: char('accent_color', { length: 7 }),
    blurHash: text('blur_hash'),
    /** Volatile. Always read alongside its as-of stamp; never treated as stable. */
    popularity: numeric('popularity', { precision: 10, scale: 4 }),
    popularityAsOf: timestamp('popularity_as_of', { withTimezone: true }),
    voteAverage: numeric('vote_average', { precision: 4, scale: 2 }),
    voteCount: integer('vote_count'),
    budget: bigint('budget', { mode: 'number' }),
    revenue: bigint('revenue', { mode: 'number' }),
    homepage: text('homepage'),
    adult: boolean('adult').notNull().default(false),
    createdAt,
    updatedAt,
    syncedAt: timestamp('synced_at', { withTimezone: true }),
  },
  (t) => [
    index('title_kind_popularity_idx').on(t.kind, t.popularity.desc()),
    index('title_release_idx').on(t.releaseDate),
    // Entity-resolution blocking key: normalized title + year.
    index('title_sort_title_idx').on(t.sortTitle),
  ],
);

export const season = core.table(
  'season',
  {
    id: pk(),
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    name: text('name'),
    overview: text('overview'),
    airDate: date('air_date'),
    episodeCount: integer('episode_count'),
    posterPath: text('poster_path'),
  },
  (t) => [uniqueIndex('season_title_number_uq').on(t.titleId, t.seasonNumber)],
);

export const episode = core.table(
  'episode',
  {
    id: pk(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    /** Denormalized from season for query speed — episode lists filter by title constantly. */
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    episodeNumber: integer('episode_number').notNull(),
    absoluteNumber: integer('absolute_number'),
    name: text('name'),
    overview: text('overview'),
    airDate: date('air_date'),
    runtimeMinutes: integer('runtime_minutes'),
    stillPath: text('still_path'),
  },
  (t) => [
    uniqueIndex('episode_season_number_uq').on(t.seasonId, t.episodeNumber),
    index('episode_title_air_idx').on(t.titleId, t.airDate),
  ],
);

export const person = core.table(
  'person',
  {
    id: pk(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    sortName: text('sort_name').notNull(),
    /** Stage names, transliterations, maiden names. Searchable without being merged. */
    alsoKnownAs: text('also_known_as').array(),
    birthday: date('birthday'),
    deathday: date('deathday'),
    placeOfBirth: text('place_of_birth'),
    biography: text('biography'),
    knownForDepartment: text('known_for_department'),
    gender: smallint('gender'),
    profilePath: text('profile_path'),
    popularity: numeric('popularity', { precision: 10, scale: 4 }),
    popularityAsOf: timestamp('popularity_as_of', { withTimezone: true }),
    createdAt,
    updatedAt,
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    /**
     * When this person's OWN record was last fetched.
     *
     * Distinct from syncedAt, which a credits payload sets: a person appears
     * in core the moment they are credited on something, carrying only a name,
     * a photo and a department. Without a separate marker there is no way to
     * tell "has no biography" from "nobody ever asked TMDB for one", and the
     * page would re-fetch on every view for anyone who genuinely has none.
     */
    detailSyncedAt: timestamp('detail_synced_at', { withTimezone: true }),
  },
  (t) => [
    index('person_sort_name_idx').on(t.sortName),
    /**
     * Fuzzy name search.
     *
     * Search reached people for the first time and immediately needed this:
     * `sort_name % 'john krasinski'` over 58,714 rows is a sequential scan
     * computing similarity for every one, measured at 109ms -- far too slow
     * for something that fires on a keystroke. The btree above cannot serve a
     * trigram operator; only a GIN trgm index can.
     */
    index('person_sort_name_trgm_idx').using('gin', sql`sort_name gin_trgm_ops`),
    /* The search also does ILIKE '%q%' to catch substrings the similarity
       threshold misses on short queries. A leading wildcard defeats a btree,
       but a GIN trgm index serves it -- which is the difference between 29ms
       and a couple. */
    index('person_name_trgm_idx').using('gin', sql`name gin_trgm_ops`),
  ],
);

export const character = core.table(
  'character',
  {
    id: pk(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    canonicalName: text('canonical_name').notNull(),
    description: text('description'),
    /** Characters usually scope to a franchise. Nullable: many do not. */
    collectionId: uuid('collection_id'),
    createdAt,
  },
  (t) => [index('character_canonical_idx').on(t.canonicalName)],
);

export const concept = core.table(
  'concept',
  {
    id: pk(),
    /** 'genre' | 'theme' | 'mood' | 'keyword' | 'format' — see ontology.yaml. */
    scheme: text('scheme').notNull(),
    slug: text('slug').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    parentId: uuid('parent_id'),
    /** True for our editorial vocabularies (theme, mood), false for provider data. */
    isCurated: boolean('is_curated').notNull().default(false),
    createdAt,
  },
  (t) => [
    uniqueIndex('concept_scheme_slug_uq').on(t.scheme, t.slug),
    index('concept_scheme_idx').on(t.scheme),
  ],
);

export const collection = core.table('collection', {
  id: pk(),
  slug: text('slug').notNull().unique(),
  kind: text('kind').notNull().default('franchise'),
  name: text('name').notNull(),
  overview: text('overview'),
  posterPath: text('poster_path'),
  createdAt,
});

export const organization = core.table(
  'organization',
  {
    id: pk(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** studio | network | distributor | streamer | production.
     *  One entity, many roles — Warner Bros. is all of them. The ROLE lives on
     *  the edge (produced_by / aired_on / available_on). See docs/adr/0002. */
    kind: text('kind').notNull(),
    country: char('country', { length: 2 }),
    logoPath: text('logo_path'),
    parentOrgId: uuid('parent_org_id'),
    createdAt,
  },
  (t) => [index('organization_kind_idx').on(t.kind)],
);

export const work = core.table('work', {
  id: pk(),
  slug: text('slug').notNull().unique(),
  /** book | comic | play | game | article | true_events | short_story */
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  authorPersonId: uuid('author_person_id').references(() => person.id),
  firstPublished: date('first_published'),
  isbn: text('isbn'),
  description: text('description'),
  createdAt,
});

// ── Relationships ────────────────────────────────────────────────────────────

/**
 * The ~85% of edges that are cast and crew. Its own table because it needs
 * billing_order, character linkage, department/job strings, and episode
 * granularity — shoving that into attributes jsonb would make the hottest query
 * in the app (ordered cast list) an unindexable jsonb sort.
 * See docs/adr/0004.
 */
export const credit = core.table(
  'credit',
  {
    id: pk(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'cascade' }),
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episode.id, { onDelete: 'cascade' }),
    /** acted_in | directed | wrote | composed_for | shot — CHECK is generated. */
    predicate: text('predicate').notNull(),
    department: text('department'),
    job: text('job'),
    characterId: uuid('character_id').references(() => character.id),
    /** Kept even when characterId resolves, so we can always show what the provider said. */
    characterNameRaw: text('character_name_raw'),
    billingOrder: smallint('billing_order'),
    episodeCount: integer('episode_count'),
    source: text('source').notNull().default('tmdb'),
    sourceCreditId: text('source_credit_id'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('1.0'),
    createdAt,
  },
  (t) => [
    // The cast list: ordered, indexed, one scan.
    index('credit_title_predicate_billing_idx').on(t.titleId, t.predicate, t.billingOrder),
    index('credit_person_predicate_idx').on(t.personId, t.predicate),
    index('credit_character_idx')
      .on(t.characterId)
      .where(sql`character_id is not null`),
    uniqueIndex('credit_natural_uq').on(
      t.personId,
      t.titleId,
      t.predicate,
      sql`coalesce(episode_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(job, '')`,
    ),
  ],
);

/** The long tail of ontology relationships. Asserted or curated — never derived. */
export const edge = core.table(
  'edge',
  {
    id: pk(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    predicate: text('predicate').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    attributes: jsonb('attributes').notNull().default({}),
    /** 'asserted' (a provider said so) | 'curated' (we decided). */
    provenance: text('provenance').notNull(),
    source: text('source'),
    sourceRef: text('source_ref'),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('1.0'),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    createdAt,
    createdBy: text('created_by'),
  },
  (t) => [
    uniqueIndex('edge_natural_uq').on(
      t.subjectType,
      t.subjectId,
      t.predicate,
      t.objectType,
      t.objectId,
    ),
    index('edge_subject_idx').on(t.subjectType, t.subjectId, t.predicate),
    // Reverse traversal. Without this, half of every path query is a seq scan.
    index('edge_object_idx').on(t.objectType, t.objectId, t.predicate),
    index('edge_curated_idx')
      .on(t.predicate)
      .where(sql`provenance = 'curated'`),
  ],
);

/**
 * Inference output. Same shape as edge, separate table so it is TRUNCATE-safe:
 * a bad similarity run can never destroy provider facts or human curation.
 */
export const edgeDerived = core.table(
  'edge_derived',
  {
    id: pk(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    predicate: text('predicate').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    attributes: jsonb('attributes').notNull().default({}),
    confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull().default('1.0'),
    /** Which algorithm produced this, so a generation can be invalidated wholesale. */
    method: text('method').notNull(),
    score: numeric('score', { precision: 6, scale: 4 }),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('edge_derived_natural_uq').on(
      t.subjectType,
      t.subjectId,
      t.predicate,
      t.objectType,
      t.objectId,
      t.method,
    ),
    index('edge_derived_subject_idx').on(t.subjectType, t.subjectId, t.predicate),
    index('edge_derived_object_idx').on(t.objectType, t.objectId, t.predicate),
  ],
);

// ── Identity and supporting tables ───────────────────────────────────────────

export const externalId = core.table(
  'external_id',
  {
    /** tmdb | imdb | tvmaze | wikidata | omdb */
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    /** The spine source for this entity. TMDB for titles and people. */
    isPrimary: boolean('is_primary').notNull().default(false),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
    lastVerified: timestamp('last_verified', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.sourceId, t.entityType] }),
    index('external_id_entity_idx').on(t.entityType, t.entityId),
  ],
);

export const entityAlias = core.table(
  'entity_alias',
  {
    id: pk(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    alias: text('alias').notNull(),
    /** aka | original | translit | misspelling | merged_from */
    aliasType: text('alias_type').notNull(),
    lang: char('lang', { length: 2 }),
  },
  (t) => [index('entity_alias_lookup_idx').on(t.entityType, t.alias)],
);

/** Every merge is reversible. revert_merge() is tested. */
export const mergeLog = core.table('merge_log', {
  id: pk(),
  entityType: text('entity_type').notNull(),
  survivingId: uuid('surviving_id').notNull(),
  mergedId: uuid('merged_id').notNull(),
  reason: text('reason').notNull(),
  evidence: jsonb('evidence').notNull().default({}),
  mergedAt: timestamp('merged_at', { withTimezone: true }).notNull().defaultNow(),
  mergedBy: text('merged_by'),
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
});

/** Ambiguous resolution candidates. Never auto-merged. */
export const erReview = core.table(
  'er_review',
  {
    id: pk(),
    entityType: text('entity_type').notNull(),
    incomingSource: text('incoming_source').notNull(),
    incomingSourceId: text('incoming_source_id').notNull(),
    candidateEntityId: uuid('candidate_entity_id'),
    similarity: numeric('similarity', { precision: 4, scale: 3 }),
    evidence: jsonb('evidence').notNull().default({}),
    status: text('status').notNull().default('open'),
    createdAt,
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('er_review_status_idx').on(t.status, t.entityType)],
);

/**
 * Volatile and regional. NOT an ontology edge — as an edge the graph would change
 * shape by territory and by week, destroying path determinism. See docs/adr/0007.
 */
export const availability = core.table(
  'availability',
  {
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    region: char('region', { length: 2 }).notNull(),
    /** flatrate | rent | buy | ads | free */
    offerType: text('offer_type').notNull(),
    link: text('link'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    validTo: timestamp('valid_to', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.titleId, t.organizationId, t.region, t.offerType] }),
    index('availability_title_region_idx').on(t.titleId, t.region),
  ],
);

/**
 * Raw provider keywords per title.
 *
 * NOT concepts and NOT edges. A folksonomy of ~8k terms mixing settings
 * ("new york city"), objects ("robot"), plot devices ("time loop") and tone
 * ("dystopia") is provider input, not ontological fact — putting it in
 * core.concept would pollute the vocabulary, and putting it in core.edge is
 * rejected by the domain/range trigger, correctly. This table is the input to
 * core.crosswalk_keyword_theme and nothing else.
 */
export const titleKeyword = core.table(
  'title_keyword',
  {
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    keywordSourceId: text('keyword_source_id').notNull(),
    keywordLabel: text('keyword_label').notNull(),
    source: text('source').notNull().default('tmdb'),
  },
  (t) => [
    primaryKey({ columns: [t.titleId, t.keywordSourceId] }),
    index('title_keyword_label_idx').on(t.keywordSourceId),
  ],
);

/** The curated folksonomy-to-vocabulary mapping. Most keywords map to nothing. */
export const crosswalkKeywordTheme = core.table(
  'crosswalk_keyword_theme',
  {
    id: pk(),
    keywordSourceId: text('keyword_source_id').notNull(),
    keywordLabel: text('keyword_label').notNull(),
    conceptId: uuid('concept_id').references(() => concept.id, { onDelete: 'cascade' }),
    salience: numeric('salience', { precision: 3, scale: 2 }).notNull().default('1.0'),
    /** 'llm_draft' | 'human'. Rows still marked llm_draft are reviewed opportunistically. */
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
  },
  (t) => [
    uniqueIndex('crosswalk_keyword_concept_uq').on(t.keywordSourceId, t.conceptId),
    // NULL != NULL in a unique index, so the composite above does NOT dedupe
    // exclusions (concept_id IS NULL). Without this partial index every reload
    // inserted another copy of every excluded keyword, and the coverage metric
    // reported 114% adjudicated — an impossible number that revealed the bug.
    uniqueIndex('crosswalk_exclusion_uq')
      .on(t.keywordSourceId)
      .where(sql`concept_id is null`),
    index('crosswalk_keyword_idx').on(t.keywordSourceId),
  ],
);

/** The entire background job system. See docs/adr/0011. */
export const job = core.table(
  'job',
  {
    id: pk(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    /** queued | running | done | failed */
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    createdAt,
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('job_claim_idx')
      .on(t.status, t.runAfter)
      .where(sql`status = 'queued'`),
    index('job_kind_status_idx').on(t.kind, t.status),
  ],
);

/** Path results keyed by unordered pair. 7-day TTL. */
export const pathCache = core.table(
  'path_cache',
  {
    /** least(a,b) so the pair is order-independent. */
    endpointLow: uuid('endpoint_low').notNull(),
    endpointHigh: uuid('endpoint_high').notNull(),
    paths: jsonb('paths').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.endpointLow, t.endpointHigh] })],
);

/** Phase 2. Materialized weekly by iterative BFS over acted_in. */
export const personBacon = core.table('person_bacon', {
  personId: uuid('person_id')
    .primaryKey()
    .references(() => person.id, { onDelete: 'cascade' }),
  baconNumber: smallint('bacon_number').notNull(),
  viaPersonId: uuid('via_person_id').references(() => person.id),
  viaTitleId: uuid('via_title_id').references(() => title.id),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Rate limiting counters.
 *
 * In core rather than usr because the buckets are keyed by IP as often as by
 * account -- an unauthenticated sign-in attempt has no account to scope to --
 * and because nothing here belongs to a person: the rows are operational, and
 * an account deletion must not erase the record of what that address has been
 * doing.
 *
 * Two rows per bucket at most (the current window and the previous one), so
 * the table stays small; housekeeping drops anything older than a day.
 */
export const rateLimit = core.table(
  'rate_limit',
  {
    /** 'auth:send:203.0.113.4', 'path:<account uuid>' — caller-defined. */
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.windowStart] }),
    // Pruning scans by age, not by bucket.
    index('rate_limit_window_idx').on(t.windowStart),
  ],
);
