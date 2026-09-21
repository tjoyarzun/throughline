import { customType, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Case-insensitive text. Used for emails so uniqueness is not case-sensitive. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/**
 * UUIDv7 — time-sortable, so B-tree inserts stay at the right edge of the index
 * instead of scattering like UUIDv4. Postgres 18 has uuidv7() built in; on 17 we
 * install our own in drizzle/sql/00-bootstrap.sql.
 */
export const uuidv7Default = sql`core.uuid_generate_v7()`;

export const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
