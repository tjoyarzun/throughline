import {
  pgSchema,
  text,
  integer,
  smallint,
  boolean,
  date,
  timestamp,
  uuid,
  char,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, createdAt, updatedAt } from './_shared';
import { title, episode } from './core';

/**
 * User-owned data. Every table here has RLS enabled and is reachable only
 * through withUser() — see docs/security.md. The application role has DML here
 * and SELECT-only on core, which is what makes "a user can never contaminate
 * the global model" structural rather than aspirational.
 */
export const usr = pgSchema('usr');

const pk = () =>
  uuid('id')
    .primaryKey()
    .default(sql`core.uuid_generate_v7()`);

export const account = usr.table('account', {
  id: pk(),
  email: citext('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  /** Drives availability lookups. */
  region: char('region', { length: 2 }).notNull().default('US'),
  locale: text('locale').notNull().default('en-US'),
  themePref: text('theme_pref').notNull().default('system'),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt,
  updatedAt,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** Invite-only signup, enforced server-side. See docs/adr/0009. */
export const invite = usr.table(
  'invite',
  {
    id: pk(),
    code: text('code').notNull().unique(),
    email: citext('email'),
    createdBy: uuid('created_by').references(() => account.id),
    redeemedBy: uuid('redeemed_by').references(() => account.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('invite_open_idx')
      .on(t.code)
      .where(sql`redeemed_at is null`),
  ],
);

/**
 * The user's STANDING RELATIONSHIP with a work. One row.
 * Distinct from usr.viewing, which is a discrete event. See docs/data-model.md.
 */
export const titleState = usr.table(
  'title_state',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    /** watchlist | watching | watched | abandoned */
    status: text('status').notNull(),
    /**
     * Orthogonal to status, not a status value: you can favorite a show you are
     * still watching. Affinity, not judgment. See docs/adr/0005.
     */
    isFavorite: boolean('is_favorite').notNull().default(false),
    favoritedAt: timestamp('favorited_at', { withTimezone: true }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt,
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.titleId] }),
    index('title_state_account_status_idx').on(t.accountId, t.status),
    index('title_state_favorite_idx')
      .on(t.accountId)
      .where(sql`is_favorite`),
  ],
);

/** APPEND ONLY. Never updated, never deleted. Nothing is destroyed. */
export const stateEvent = usr.table(
  'state_event',
  {
    id: pk(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    /** status_change | favorited | unfavorited */
    eventKind: text('event_kind').notNull().default('status_change'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** manual | auto_from_viewing | auto_from_episode | import */
    source: text('source').notNull().default('manual'),
  },
  (t) => [index('state_event_account_time_idx').on(t.accountId, t.occurredAt)],
);

/**
 * Versioned judgment. Half-stars stored as 1..10, displayed 0.5-5.0.
 * Current rating is the row WHERE superseded_at IS NULL; history is preserved,
 * which makes "3 stars in 2019, 5 on rewatch" representable.
 */
export const rating = usr.table(
  'rating',
  {
    id: pk(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    value: smallint('value').notNull(),
    ratedAt: timestamp('rated_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    viewingId: uuid('viewing_id'),
  },
  (t) => [
    // At most one current rating per title per account.
    uniqueIndex('rating_current_uq')
      .on(t.accountId, t.titleId)
      .where(sql`superseded_at is null`),
    index('rating_account_idx').on(t.accountId, t.titleId),
  ],
);

/** A discrete event. Zero-to-many per title — watching something three times is three rows. */
export const viewing = usr.table(
  'viewing',
  {
    id: pk(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episode.id, { onDelete: 'cascade' }),
    watchedOn: date('watched_on'),
    /**
     * exact | day | month | year | unknown.
     * 'unknown' is what makes "watched, date unknown" distinguishable from
     * "watched on 2026-03-14" in time-series metrics. Retroactive entries are
     * legal and must not pollute the timeline.
     */
    datePrecision: text('date_precision').notNull().default('day'),
    companions: text('companions').array(),
    location: text('location'),
    /** theater | streaming | physical | tv | flight */
    medium: text('medium'),
    isRewatch: boolean('is_rewatch').notNull().default(false),
    note: text('note'),
    createdAt,
  },
  (t) => [
    index('viewing_account_watched_idx').on(t.accountId, t.watchedOn),
    index('viewing_title_idx').on(t.accountId, t.titleId),
  ],
);

export const episodeProgress = usr.table(
  'episode_progress',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id, { onDelete: 'cascade' }),
    /** Denormalized so progress aggregates do not join through season. */
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    watchedAt: timestamp('watched_at', { withTimezone: true }).notNull().defaultNow(),
    viewingId: uuid('viewing_id').references(() => viewing.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.episodeId] }),
    index('episode_progress_title_idx').on(t.accountId, t.titleId),
  ],
);

/** Notes can attach to people and concepts too, not only titles. */
export const note = usr.table(
  'note',
  {
    id: pk(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    body: text('body').notNull(),
    isPrivate: boolean('is_private').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [index('note_account_subject_idx').on(t.accountId, t.subjectType, t.subjectId)],
);

/**
 * Snapshots rating and note at creation. You sent someone "I gave it 4.5" —
 * re-rating later must not silently rewrite the message. See docs/adr/0008.
 */
export const share = usr.table(
  'share',
  {
    id: pk(),
    /** 21-char nanoid, ~126 bits. An unguessable capability URL. */
    slug: text('slug').notNull().unique(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    titleId: uuid('title_id')
      .notNull()
      .references(() => title.id, { onDelete: 'cascade' }),
    includeRating: boolean('include_rating').notNull().default(true),
    ratingSnapshot: smallint('rating_snapshot'),
    noteSnapshot: text('note_snapshot'),
    message: text('message'),
    createdAt,
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
  },
  (t) => [index('share_account_idx').on(t.accountId, t.createdAt)],
);
