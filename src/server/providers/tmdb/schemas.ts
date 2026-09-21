import { z } from 'zod';

/**
 * Zod at the provider boundary.
 *
 * Provider fields change without notice. Parsing here means we get a typed
 * failure at the edge with the offending field path, rather than `undefined`
 * three layers in where it will be written to core as a null and quietly
 * corrupt the canonical model.
 *
 * Everything optional is `.nullish()` on purpose: TMDB uses null, undefined and
 * empty string interchangeably for "absent", and being strict about which would
 * reject valid records.
 */

const nullableString = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
const nullableNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? null);

/** TMDB returns '' for absent dates, which is not a valid date. */
const looseDate = z
  .string()
  .nullish()
  .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null));

export const tmdbGenre = z.object({ id: z.number(), name: z.string() });

export const tmdbCastMember = z.object({
  id: z.number(),
  name: z.string(),
  original_name: nullableString,
  character: nullableString,
  credit_id: z.string(),
  order: nullableNumber,
  profile_path: nullableString,
  known_for_department: nullableString,
  gender: nullableNumber,
  popularity: nullableNumber,
});

export const tmdbCrewMember = z.object({
  id: z.number(),
  name: z.string(),
  original_name: nullableString,
  job: z.string(),
  department: nullableString,
  credit_id: z.string(),
  profile_path: nullableString,
  known_for_department: nullableString,
  gender: nullableNumber,
  popularity: nullableNumber,
});

export const tmdbCredits = z.object({
  cast: z.array(tmdbCastMember).default([]),
  crew: z.array(tmdbCrewMember).default([]),
});

export const tmdbKeywords = z.object({
  keywords: z.array(tmdbGenre).optional(),
  results: z.array(tmdbGenre).optional(),
});

export const tmdbCollectionRef = z.object({
  id: z.number(),
  name: z.string(),
  poster_path: nullableString,
});

export const tmdbCompany = z.object({
  id: z.number(),
  name: z.string(),
  logo_path: nullableString,
  origin_country: nullableString,
});

export const tmdbNetwork = tmdbCompany;

export const tmdbExternalIds = z.object({
  imdb_id: nullableString,
  wikidata_id: nullableString,
  tvdb_id: nullableNumber,
});

export const tmdbMovie = z.object({
  id: z.number(),
  title: z.string(),
  original_title: nullableString,
  release_date: looseDate,
  runtime: nullableNumber,
  status: nullableString,
  overview: nullableString,
  original_language: nullableString,
  poster_path: nullableString,
  backdrop_path: nullableString,
  popularity: nullableNumber,
  vote_average: nullableNumber,
  vote_count: nullableNumber,
  budget: nullableNumber,
  revenue: nullableNumber,
  homepage: nullableString,
  adult: z.boolean().default(false),
  imdb_id: nullableString,
  genres: z.array(tmdbGenre).default([]),
  belongs_to_collection: tmdbCollectionRef.nullish().transform((v) => v ?? null),
  production_companies: z.array(tmdbCompany).default([]),
  credits: tmdbCredits.optional(),
  keywords: tmdbKeywords.optional(),
  external_ids: tmdbExternalIds.partial().optional(),
});

export const tmdbSeasonSummary = z.object({
  id: z.number(),
  season_number: z.number(),
  name: nullableString,
  overview: nullableString,
  air_date: looseDate,
  episode_count: nullableNumber,
  poster_path: nullableString,
});

export const tmdbShow = z.object({
  id: z.number(),
  name: z.string(),
  original_name: nullableString,
  first_air_date: looseDate,
  last_air_date: looseDate,
  episode_run_time: z.array(z.number()).default([]),
  status: nullableString,
  overview: nullableString,
  original_language: nullableString,
  poster_path: nullableString,
  backdrop_path: nullableString,
  popularity: nullableNumber,
  vote_average: nullableNumber,
  vote_count: nullableNumber,
  homepage: nullableString,
  adult: z.boolean().default(false),
  genres: z.array(tmdbGenre).default([]),
  networks: z.array(tmdbNetwork).default([]),
  production_companies: z.array(tmdbCompany).default([]),
  seasons: z.array(tmdbSeasonSummary).default([]),
  credits: tmdbCredits.optional(),
  aggregate_credits: z
    .object({
      cast: z
        .array(
          z.object({
            id: z.number(),
            name: z.string(),
            profile_path: nullableString,
            known_for_department: nullableString,
            gender: nullableNumber,
            popularity: nullableNumber,
            total_episode_count: nullableNumber,
            order: nullableNumber,
            roles: z
              .array(z.object({ character: nullableString, credit_id: z.string() }))
              .default([]),
          }),
        )
        .default([]),
      // NOTE: TV aggregate_credits crew differs from movie credits crew. A
      // person can hold several jobs across a series run, so TMDB nests them
      // as `jobs: [{job, credit_id, episode_count}]` with no top-level `job`.
      // The Zod boundary caught this on the first live show ingest.
      crew: z
        .array(
          z.object({
            id: z.number(),
            name: z.string(),
            jobs: z
              .array(
                z.object({
                  job: z.string(),
                  credit_id: z.string(),
                  episode_count: nullableNumber,
                }),
              )
              .default([]),
            department: nullableString,
            profile_path: nullableString,
            known_for_department: nullableString,
            gender: nullableNumber,
            popularity: nullableNumber,
            total_episode_count: nullableNumber,
          }),
        )
        .default([]),
    })
    .optional(),
  keywords: tmdbKeywords.optional(),
  external_ids: tmdbExternalIds.partial().optional(),
});

export const tmdbPerson = z.object({
  id: z.number(),
  name: z.string(),
  also_known_as: z.array(z.string()).default([]),
  birthday: looseDate,
  deathday: looseDate,
  place_of_birth: nullableString,
  biography: nullableString,
  known_for_department: nullableString,
  gender: nullableNumber,
  profile_path: nullableString,
  popularity: nullableNumber,
  imdb_id: nullableString,
});

export const tmdbPaged = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    page: z.number(),
    total_pages: z.number(),
    total_results: z.number(),
    results: z.array(item),
  });

export const tmdbListItem = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(),
  media_type: z.string().optional(),
  popularity: nullableNumber,
});

export type TmdbMovie = z.infer<typeof tmdbMovie>;
export type TmdbShow = z.infer<typeof tmdbShow>;
export type TmdbPerson = z.infer<typeof tmdbPerson>;
export type TmdbCredits = z.infer<typeof tmdbCredits>;
