import type { z } from 'zod';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * TMDB client. Server-only — the token never reaches a browser.
 *
 * Auth is the v4 Read Access Token as a Bearer header, NOT the v3 `api_key`
 * query parameter: we log request paths, and a query-string credential would be
 * written into our own logs and any intermediary's.
 *
 * Four layers, in order: token bucket -> circuit breaker -> retry -> Zod parse.
 */

const BASE = 'https://api.themoviedb.org/3';

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = 'TmdbError';
  }
}

/**
 * TMDB tolerates roughly 50 req/s per IP. We sit at 30 to leave headroom for
 * anything else running against the same address, and because being rate
 * limited costs more than going slightly slower.
 */
class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
  }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(
        this.capacity,
        this.tokens + ((now - this.last) / 1000) * this.refillPerSecond,
      );
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil((1 - this.tokens) / this.refillPerSecond) * 1000);
    }
  }
}

/**
 * Degrade to cached or partial data rather than erroring the page. Opens after
 * repeated failures, half-opens after a cooldown so one probe can close it.
 */
class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  constructor(
    private readonly threshold = 8,
    private readonly cooldownMs = 30_000,
  ) {}
  get state(): 'closed' | 'open' | 'half-open' {
    if (this.openedAt === null) return 'closed';
    return Date.now() - this.openedAt > this.cooldownMs ? 'half-open' : 'open';
  }
  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }
  recordFailure(): void {
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = Date.now();
  }
  assertClosed(path: string): void {
    if (this.state === 'open') {
      throw new TmdbError('TMDB circuit breaker is open; serving cached data only', 503, path);
    }
  }
}

export interface TmdbStats {
  requests: number;
  retries: number;
  rateLimited: number;
  failures: number;
  circuit: 'closed' | 'open' | 'half-open';
}

export class TmdbClient {
  private readonly bucket = new TokenBucket(30, 30);
  private readonly breaker = new CircuitBreaker();
  private stats = { requests: 0, retries: 0, rateLimited: 0, failures: 0 };

  constructor(
    private readonly token = process.env.TMDB_READ_ACCESS_TOKEN,
    private readonly onRaw?: (
      resource: string,
      sourceId: string,
      variant: string,
      payload: unknown,
      status: number,
    ) => Promise<void>,
  ) {
    if (!this.token) throw new Error('TMDB_READ_ACCESS_TOKEN is not set');
  }

  getStats(): TmdbStats {
    return { ...this.stats, circuit: this.breaker.state };
  }

  /**
   * @param revalidate seconds to let Next's data cache serve this response.
   *   Omitted for anything we store: a cached payload that then gets written to
   *   core would freeze stale data into the corpus. Used only for the volatile
   *   ranking endpoints, where a few hours old is the point.
   */
  private async request(
    path: string,
    params: Record<string, string> = {},
    revalidate?: number,
  ): Promise<unknown> {
    this.breaker.assertClosed(path);
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.bucket.take();
      this.stats.requests++;
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
          ...(revalidate === undefined ? {} : { next: { revalidate } }),
        });

        if (res.status === 429) {
          this.stats.rateLimited++;
          this.stats.retries++;
          const retryAfter = Number(res.headers.get('retry-after') ?? '1');
          await sleep(Math.max(1000, retryAfter * 1000));
          continue;
        }
        if (res.status === 404) {
          // Not an error condition: a title we asked about does not exist.
          this.breaker.recordSuccess();
          return null;
        }
        if (res.status >= 500) {
          this.stats.retries++;
          lastError = new TmdbError(`TMDB ${res.status}`, res.status, path);
          // Jittered backoff so parallel workers do not retry in lockstep.
          await sleep(500 * 2 ** attempt + Math.random() * 300);
          continue;
        }
        if (!res.ok) {
          this.breaker.recordFailure();
          this.stats.failures++;
          throw new TmdbError(`TMDB ${res.status}: ${await res.text()}`, res.status, path);
        }

        this.breaker.recordSuccess();
        return await res.json();
      } catch (e) {
        if (e instanceof TmdbError && e.status < 500) throw e;
        lastError = e;
        this.stats.retries++;
        await sleep(500 * 2 ** attempt + Math.random() * 300);
      }
    }

    this.breaker.recordFailure();
    this.stats.failures++;
    throw new TmdbError(
      `TMDB failed after 4 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      502,
      path,
    );
  }

  /** Fetch, capture the raw payload, then parse. Capture happens BEFORE parsing
   *  on purpose: a payload that fails validation is exactly the one worth keeping. */
  private async fetchParsed<T extends z.ZodTypeAny>(
    schema: T,
    path: string,
    resource: string,
    sourceId: string,
    variant: string,
    params?: Record<string, string>,
  ): Promise<z.infer<T> | null> {
    const raw = await this.request(path, params);
    if (raw === null) return null;
    if (this.onRaw) await this.onRaw(resource, sourceId, variant, raw, 200);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new TmdbError(
        `TMDB response failed validation at ${issue?.path.join('.') ?? '?'}: ${issue?.message}`,
        502,
        path,
      );
    }
    return parsed.data;
  }

  async movie(id: number, schema: z.ZodTypeAny) {
    return this.fetchParsed(schema, `/movie/${id}`, 'movie', String(id), 'full', {
      append_to_response: 'credits,keywords,external_ids',
    });
  }

  async show(id: number, schema: z.ZodTypeAny) {
    return this.fetchParsed(schema, `/tv/${id}`, 'tv', String(id), 'full', {
      append_to_response: 'aggregate_credits,keywords,external_ids',
    });
  }

  async person(id: number, schema: z.ZodTypeAny) {
    return this.fetchParsed(schema, `/person/${id}`, 'person', String(id), 'full', {
      append_to_response: 'external_ids',
    });
  }

  async season(showId: number, seasonNumber: number, schema: z.ZodTypeAny) {
    return this.fetchParsed(
      schema,
      `/tv/${showId}/season/${seasonNumber}`,
      'tv_season',
      `${showId}:${seasonNumber}`,
      'full',
    );
  }

  /**
   * Where a title can be watched, by region.
   *
   * Not captured to raw, unlike movie/show/person. raw exists so stored facts
   * can be re-derived when our interpretation of them changes; availability is
   * not a fact about the work, it is a fact about this week in this territory.
   * Its history lives in core.availability's observed_at and valid_to, which
   * is the shape that can actually answer "when did this leave Netflix".
   *
   * Cached for 12 hours: the data changes weekly at best, and a title page
   * should not spend a provider call on it every render.
   */
  async watchProviders(kind: 'movie' | 'show', id: number, schema: z.ZodTypeAny) {
    const path = `/${kind === 'show' ? 'tv' : 'movie'}/${id}/watch/providers`;
    const raw = await this.request(path, {}, 43_200);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new TmdbError(
        `TMDB response failed validation at ${issue?.path.join('.') ?? '?'}: ${issue?.message}`,
        502,
        path,
      );
    }
    return parsed.data as unknown;
  }

  /** List endpoints are not captured to raw: they are volatile rankings, not facts. */
  async list(path: string, page: number): Promise<unknown> {
    return this.request(path, { page: String(page) });
  }

  async personCredits(personId: number, kind: 'movie' | 'tv'): Promise<unknown> {
    return this.request(`/person/${personId}/${kind}_credits`);
  }

  async collection(id: number): Promise<unknown> {
    return this.request(`/collection/${id}`);
  }

  async discover(params: Record<string, string>): Promise<unknown> {
    return this.request('/discover/movie', params);
  }

  /** Volatile discovery lists. Cached, never captured to raw, never stored. */
  async discoverCached(
    path: '/discover/movie' | '/discover/tv',
    params: Record<string, string>,
    revalidate: number,
  ): Promise<unknown> {
    return this.request(path, params, revalidate);
  }
}
