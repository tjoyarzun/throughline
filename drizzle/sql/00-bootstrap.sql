-- Schemas, extensions, and primitives. Idempotent; runs before every migration.

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS sem;
CREATE SCHEMA IF NOT EXISTS usr;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid, gen_random_bytes
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy title matching for entity resolution
CREATE EXTENSION IF NOT EXISTS unaccent;   -- title normalization

-- UUIDv7: time-sortable, so inserts land at the right edge of the B-tree instead
-- of scattering like v4. Postgres 18 ships uuidv7(); on 17 we install our own.
CREATE OR REPLACE FUNCTION core.uuid_generate_v7() RETURNS uuid AS $$
BEGIN
  RETURN encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(
            int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3
          )
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex')::uuid;
END $$ LANGUAGE plpgsql VOLATILE;

COMMENT ON FUNCTION core.uuid_generate_v7() IS
  'Time-ordered UUIDv7. Replace with the built-in uuidv7() when we move to Postgres 18.';

-- Title normalization for entity-resolution blocking. Must match the TypeScript
-- implementation in src/server/ingest/normalize.ts exactly; a test asserts it.
CREATE OR REPLACE FUNCTION core.normalize_title(input text) RETURNS text AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(unaccent(coalesce(input, ''))),
        '\s*\(\d{4}\)\s*$', '', 'g'            -- trailing (year)
      ),
      '^(the|a|an|le|la|les|el|der|die|das)\s+', '', 'g'  -- leading article
    ),
    '[^a-z0-9]+', '', 'g'                       -- punctuation and spaces
  );
$$ LANGUAGE sql IMMUTABLE STRICT;
