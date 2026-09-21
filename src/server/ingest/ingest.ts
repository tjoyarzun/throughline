import type { Sql } from './resolve';
import { resolveTitle, resolvePerson } from './resolve';
import { normalizeTitle, personSortName, slugify } from './normalize';
import type { TmdbClient } from '../providers/tmdb/client';
import { tmdbMovie, tmdbShow, type TmdbMovie, type TmdbShow } from '../providers/tmdb/schemas';

/**
 * Provider payload -> canonical entities and ontology edges.
 *
 * Every write here is an idempotent upsert keyed on the natural key, so
 * re-running the whole ingest produces byte-identical core state apart from
 * synced_at. That is asserted by a test, and it is what makes the crosswalk
 * replayable: change the theme vocabulary, re-derive, no re-crawl.
 */

const CREDIT_JOBS: Record<string, string> = {
  Director: 'directed',
  Screenplay: 'wrote',
  Writer: 'wrote',
  Story: 'wrote',
  Teleplay: 'wrote',
  'Original Music Composer': 'composed_for',
  'Director of Photography': 'shot',
};

export interface IngestStats {
  titles: number;
  people: number;
  credits: number;
  edges: number;
  concepts: number;
  reused: number;
  created: number;
}

export class Ingestor {
  readonly stats: IngestStats = {
    titles: 0,
    people: 0,
    credits: 0,
    edges: 0,
    concepts: 0,
    reused: 0,
    created: 0,
  };
  /** Within one run, avoid re-resolving the same person hundreds of times. */
  private personCache = new Map<number, string>();
  private conceptCache = new Map<string, string>();
  private orgCache = new Map<string, string>();

  constructor(
    private readonly sql: Sql,
    private readonly tmdb: TmdbClient,
  ) {}

  // ── Concepts, organizations, collections ───────────────────────────────────

  async upsertConcept(scheme: string, label: string, isCurated = false): Promise<string> {
    const slug = slugify(label);
    const key = `${scheme}:${slug}`;
    const cached = this.conceptCache.get(key);
    if (cached) return cached;
    const [row] = await this.sql<{ id: string }[]>`
      INSERT INTO core.concept (scheme, slug, label, is_curated)
      VALUES (${scheme}, ${slug}, ${label}, ${isCurated})
      ON CONFLICT (scheme, slug) DO UPDATE SET label = excluded.label
      RETURNING id`;
    this.conceptCache.set(key, row!.id);
    this.stats.concepts++;
    return row!.id;
  }

  async upsertOrganization(
    tmdbId: number,
    name: string,
    kind: string,
    logo: string | null,
    country: string | null,
  ): Promise<string> {
    const key = `${kind}:${tmdbId}`;
    const cached = this.orgCache.get(key);
    if (cached) return cached;
    const existing = await this.sql<{ entity_id: string }[]>`
      SELECT entity_id FROM core.external_id
      WHERE source = 'tmdb' AND source_id = ${`${kind}:${tmdbId}`} AND entity_type = 'organization'`;
    if (existing[0]) {
      this.orgCache.set(key, existing[0].entity_id);
      return existing[0].entity_id;
    }
    const [row] = await this.sql<{ id: string }[]>`
      INSERT INTO core.organization (slug, name, kind, logo_path, country)
      VALUES (${slugify(name, kind === 'network' ? 'network' : undefined)}, ${name}, ${kind}, ${logo}, ${country})
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name
      RETURNING id`;
    await this.sql`
      INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary)
      VALUES ('tmdb', ${`${kind}:${tmdbId}`}, 'organization', ${row!.id}, true)
      ON CONFLICT DO NOTHING`;
    this.orgCache.set(key, row!.id);
    return row!.id;
  }

  async upsertCollection(tmdbId: number, name: string, poster: string | null): Promise<string> {
    const existing = await this.sql<{ entity_id: string }[]>`
      SELECT entity_id FROM core.external_id
      WHERE source = 'tmdb' AND source_id = ${String(tmdbId)} AND entity_type = 'collection'`;
    if (existing[0]) return existing[0].entity_id;
    const [row] = await this.sql<{ id: string }[]>`
      INSERT INTO core.collection (slug, kind, name, poster_path)
      VALUES (${slugify(name)}, 'franchise', ${name}, ${poster})
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name
      RETURNING id`;
    await this.sql`
      INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary)
      VALUES ('tmdb', ${String(tmdbId)}, 'collection', ${row!.id}, true)
      ON CONFLICT DO NOTHING`;
    return row!.id;
  }

  // ── Edges ──────────────────────────────────────────────────────────────────

  /** Idempotent. Re-asserting an edge updates confidence rather than duplicating. */
  async assertEdge(
    subjectType: string,
    subjectId: string,
    predicate: string,
    objectType: string,
    objectId: string,
    provenance: 'asserted' | 'curated' = 'asserted',
    attributes: Record<string, unknown> = {},
    source = 'tmdb',
  ): Promise<void> {
    await this.sql`
      INSERT INTO core.edge
        (subject_type, subject_id, predicate, object_type, object_id, attributes, provenance, source)
      VALUES (${subjectType}, ${subjectId}, ${predicate}, ${objectType}, ${objectId},
              ${this.sql.json(attributes as never)}, ${provenance}, ${source})
      ON CONFLICT (subject_type, subject_id, predicate, object_type, object_id)
      DO UPDATE SET attributes = excluded.attributes, source = excluded.source`;
    this.stats.edges++;
  }

  // ── People ─────────────────────────────────────────────────────────────────

  async ensurePerson(p: {
    id: number;
    name: string;
    profile_path: string | null;
    known_for_department: string | null;
    gender: number | null;
    popularity: number | null;
  }): Promise<string> {
    const cached = this.personCache.get(p.id);
    if (cached) return cached;

    const res = await resolvePerson(this.sql, {
      tmdbId: p.id,
      imdbId: null,
      name: p.name,
      birthday: null,
      knownTitleIds: [],
    });

    let id = res.entityId;
    if (res.created) {
      const [row] = await this.sql<{ id: string }[]>`
        INSERT INTO core.person (slug, name, sort_name, known_for_department, gender, profile_path, popularity, synced_at)
        VALUES (${slugify(p.name, p.id)}, ${p.name}, ${personSortName(p.name)},
                ${p.known_for_department}, ${p.gender}, ${p.profile_path}, ${p.popularity}, now())
        ON CONFLICT (slug) DO UPDATE SET name = excluded.name, synced_at = now()
        RETURNING id`;
      id = row!.id;
      await this.sql`
        INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary, last_verified)
        VALUES ('tmdb', ${String(p.id)}, 'person', ${id}, true, now())
        ON CONFLICT (source, source_id, entity_type) DO UPDATE SET last_verified = now()`;
      this.stats.people++;
      this.stats.created++;
    } else {
      this.stats.reused++;
      // Refresh volatile fields on an entity we already had.
      await this.sql`
        UPDATE core.person SET popularity = ${p.popularity}, popularity_as_of = now(),
               profile_path = coalesce(${p.profile_path}, profile_path), synced_at = now()
        WHERE id = ${id}`;
    }
    this.personCache.set(p.id, id);
    return id;
  }

  async upsertCredit(
    personId: string,
    titleId: string,
    predicate: string,
    opts: {
      job?: string | null | undefined;
      department?: string | null | undefined;
      character?: string | null | undefined;
      billingOrder?: number | null | undefined;
      episodeCount?: number | null | undefined;
      sourceCreditId?: string | null | undefined;
    } = {},
  ): Promise<void> {
    await this.sql`
      INSERT INTO core.credit
        (person_id, title_id, predicate, department, job, character_name_raw,
         billing_order, episode_count, source, source_credit_id)
      VALUES (${personId}, ${titleId}, ${predicate}, ${opts.department ?? null}, ${opts.job ?? null},
              ${opts.character ?? null}, ${opts.billingOrder ?? null}, ${opts.episodeCount ?? null},
              'tmdb', ${opts.sourceCreditId ?? null})
      ON CONFLICT (person_id, title_id, predicate,
                   coalesce(episode_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   coalesce(job, ''))
      DO UPDATE SET billing_order = excluded.billing_order,
                    character_name_raw = coalesce(excluded.character_name_raw, core.credit.character_name_raw),
                    episode_count = excluded.episode_count`;
    this.stats.credits++;
  }

  // ── Titles ─────────────────────────────────────────────────────────────────

  async ingestMovie(tmdbId: number): Promise<string | null> {
    const m = (await this.tmdb.movie(tmdbId, tmdbMovie)) as TmdbMovie | null;
    if (!m) return null;
    return this.persistMovie(m);
  }

  async persistMovie(m: TmdbMovie): Promise<string> {
    const year = m.release_date ? Number(m.release_date.slice(0, 4)) : null;
    const topCast = (m.credits?.cast ?? []).slice(0, 5).map((c) => c.id);
    const imdbId = m.imdb_id ?? m.external_ids?.imdb_id ?? null;

    const res = await resolveTitle(this.sql, {
      tmdbId: m.id,
      imdbId,
      kind: 'movie',
      title: m.title,
      releaseYear: year,
      runtimeMinutes: m.runtime,
      topCastTmdbIds: topCast,
    });

    let titleId = res.entityId;
    if (res.created) {
      const [row] = await this.sql<{ id: string }[]>`
        INSERT INTO core.title
          (slug, kind, title, original_title, sort_title, release_date, runtime_minutes, status,
           overview, original_language, poster_path, backdrop_path, popularity, popularity_as_of,
           vote_average, vote_count, budget, revenue, homepage, adult, synced_at)
        VALUES (${slugify(m.title, year ?? m.id)}, 'movie', ${m.title}, ${m.original_title},
                ${normalizeTitle(m.title)}, ${m.release_date}, ${m.runtime}, ${m.status},
                ${m.overview}, ${m.original_language}, ${m.poster_path}, ${m.backdrop_path},
                ${m.popularity}, now(), ${m.vote_average}, ${m.vote_count},
                ${m.budget}, ${m.revenue}, ${m.homepage}, ${m.adult}, now())
        ON CONFLICT (slug) DO UPDATE SET title = excluded.title, synced_at = now()
        RETURNING id`;
      titleId = row!.id;
      await this.sql`
        INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary, last_verified)
        VALUES ('tmdb', ${String(m.id)}, 'title', ${titleId}, true, now())
        ON CONFLICT (source, source_id, entity_type) DO UPDATE SET last_verified = now()`;
      if (imdbId) {
        await this.sql`
          INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary, last_verified)
          VALUES ('imdb', ${imdbId}, 'title', ${titleId}, false, now())
          ON CONFLICT (source, source_id, entity_type) DO UPDATE SET last_verified = now()`;
      }
      this.stats.created++;
    } else {
      this.stats.reused++;
      await this.sql`
        UPDATE core.title SET popularity = ${m.popularity}, popularity_as_of = now(),
               vote_average = ${m.vote_average}, vote_count = ${m.vote_count}, synced_at = now()
        WHERE id = ${titleId}`;
    }
    this.stats.titles++;

    await this.attachCommon(titleId, m.genres, m.production_companies, m.keywords, 'movie');

    if (m.belongs_to_collection) {
      const colId = await this.upsertCollection(
        m.belongs_to_collection.id,
        m.belongs_to_collection.name,
        m.belongs_to_collection.poster_path,
      );
      await this.assertEdge('title', titleId, 'part_of_franchise', 'collection', colId);
    }

    for (const c of (m.credits?.cast ?? []).slice(0, 20)) {
      const pid = await this.ensurePerson(c);
      await this.upsertCredit(pid, titleId, 'acted_in', {
        character: c.character,
        billingOrder: c.order,
        sourceCreditId: c.credit_id,
        job: 'Actor',
      });
    }
    for (const c of m.credits?.crew ?? []) {
      const predicate = CREDIT_JOBS[c.job];
      if (!predicate) continue;
      const pid = await this.ensurePerson(c);
      await this.upsertCredit(pid, titleId, predicate, {
        job: c.job,
        department: c.department,
        sourceCreditId: c.credit_id,
      });
    }
    return titleId;
  }

  async ingestShow(tmdbId: number): Promise<string | null> {
    const s = (await this.tmdb.show(tmdbId, tmdbShow)) as TmdbShow | null;
    if (!s) return null;
    return this.persistShow(s);
  }

  async persistShow(s: TmdbShow): Promise<string> {
    const year = s.first_air_date ? Number(s.first_air_date.slice(0, 4)) : null;
    const runtime = s.episode_run_time[0] ?? null;
    const topCast = (s.aggregate_credits?.cast ?? []).slice(0, 5).map((c) => c.id);
    const imdbId = s.external_ids?.imdb_id ?? null;

    const res = await resolveTitle(this.sql, {
      tmdbId: s.id,
      imdbId,
      kind: 'show',
      title: s.name,
      releaseYear: year,
      runtimeMinutes: runtime,
      topCastTmdbIds: topCast,
    });

    let titleId = res.entityId;
    if (res.created) {
      const [row] = await this.sql<{ id: string }[]>`
        INSERT INTO core.title
          (slug, kind, title, original_title, sort_title, release_date, end_date, runtime_minutes,
           status, overview, original_language, poster_path, backdrop_path, popularity,
           popularity_as_of, vote_average, vote_count, homepage, adult, synced_at)
        VALUES (${slugify(s.name, year ?? s.id)}, 'show', ${s.name}, ${s.original_name},
                ${normalizeTitle(s.name)}, ${s.first_air_date}, ${s.last_air_date}, ${runtime},
                ${s.status}, ${s.overview}, ${s.original_language}, ${s.poster_path},
                ${s.backdrop_path}, ${s.popularity}, now(), ${s.vote_average}, ${s.vote_count},
                ${s.homepage}, ${s.adult}, now())
        ON CONFLICT (slug) DO UPDATE SET title = excluded.title, synced_at = now()
        RETURNING id`;
      titleId = row!.id;
      await this.sql`
        INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary, last_verified)
        VALUES ('tmdb', ${String(s.id)}, 'title', ${titleId}, true, now())
        ON CONFLICT (source, source_id, entity_type) DO UPDATE SET last_verified = now()`;
      // Shows must write the IMDb link here too, exactly as movies do. Omitting
      // it made ingest non-idempotent: resolveTitle adds the link on the NEXT
      // run, so a second identical ingest produced one extra external_id row
      // and show IMDb ids arrived a run late.
      if (imdbId) {
        await this.sql`
          INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary, last_verified)
          VALUES ('imdb', ${imdbId}, 'title', ${titleId}, false, now())
          ON CONFLICT (source, source_id, entity_type) DO UPDATE SET last_verified = now()`;
      }
      this.stats.created++;
    } else {
      this.stats.reused++;
      await this.sql`
        UPDATE core.title SET popularity = ${s.popularity}, popularity_as_of = now(), synced_at = now()
        WHERE id = ${titleId}`;
    }
    this.stats.titles++;

    await this.attachCommon(titleId, s.genres, s.production_companies, s.keywords, 'show');

    for (const n of s.networks) {
      const orgId = await this.upsertOrganization(
        n.id,
        n.name,
        'network',
        n.logo_path,
        n.origin_country,
      );
      await this.assertEdge('title', titleId, 'aired_on', 'organization', orgId);
    }

    for (const season of s.seasons) {
      await this.sql`
        INSERT INTO core.season (title_id, season_number, name, overview, air_date, episode_count, poster_path)
        VALUES (${titleId}, ${season.season_number}, ${season.name}, ${season.overview},
                ${season.air_date}, ${season.episode_count}, ${season.poster_path})
        ON CONFLICT (title_id, season_number)
        DO UPDATE SET name = excluded.name, episode_count = excluded.episode_count`;
    }

    for (const c of (s.aggregate_credits?.cast ?? []).slice(0, 20)) {
      const pid = await this.ensurePerson(c);
      await this.upsertCredit(pid, titleId, 'acted_in', {
        character: c.roles[0]?.character ?? null,
        billingOrder: c.order,
        episodeCount: c.total_episode_count,
        sourceCreditId: c.roles[0]?.credit_id,
        job: 'Actor',
      });
    }
    // One person may hold several jobs across a series run (writer on some
    // episodes, director on others), so each entry fans out.
    for (const c of s.aggregate_credits?.crew ?? []) {
      const relevant = c.jobs.filter((j) => CREDIT_JOBS[j.job]);
      if (relevant.length === 0) continue;
      const pid = await this.ensurePerson(c);
      for (const j of relevant) {
        await this.upsertCredit(pid, titleId, CREDIT_JOBS[j.job]!, {
          job: j.job,
          department: c.department,
          episodeCount: j.episode_count,
          sourceCreditId: j.credit_id,
        });
      }
    }
    return titleId;
  }

  /** Genres, studios and raw keywords — shared by movies and shows. */
  private async attachCommon(
    titleId: string,
    genres: { id: number; name: string }[],
    companies: {
      id: number;
      name: string;
      logo_path: string | null;
      origin_country: string | null;
    }[],
    keywords:
      | {
          keywords?: { id: number; name: string }[] | undefined;
          results?: { id: number; name: string }[] | undefined;
        }
      | undefined,
    _kind: 'movie' | 'show',
  ): Promise<void> {
    for (const g of genres) {
      const cid = await this.upsertConcept('genre', g.name, false);
      await this.assertEdge('title', titleId, 'belongs_to_genre', 'concept', cid);
    }
    for (const co of companies.slice(0, 6)) {
      const orgId = await this.upsertOrganization(
        co.id,
        co.name,
        'studio',
        co.logo_path,
        co.origin_country,
      );
      await this.assertEdge('title', titleId, 'produced_by', 'organization', orgId);
    }
    // Raw keywords go to core.title_keyword, NOT to core.concept and NOT to
    // core.edge. They are folksonomy input to the theme crosswalk. The first
    // draft wrote them as belongs_to_genre edges and the ontology trigger
    // rejected it — correctly, since a keyword is not a genre.
    const kws = keywords?.keywords ?? keywords?.results ?? [];
    for (const k of kws) {
      await this.sql`
        INSERT INTO core.title_keyword (title_id, keyword_source_id, keyword_label)
        VALUES (${titleId}, ${String(k.id)}, ${k.name})
        ON CONFLICT (title_id, keyword_source_id) DO NOTHING`;
    }
  }
}
