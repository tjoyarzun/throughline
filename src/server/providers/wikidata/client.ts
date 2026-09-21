import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Wikidata SPARQL client.
 *
 * Wikidata is the ONTOLOGY enricher, not a catalog source. TMDB has excellent
 * catalog data and a weak ontology — no notion of adaptation source, influence,
 * or reliable series membership. Wikidata has exactly those, under CC0, and the
 * two join through the IMDb id both carry. See docs/adr/0006.
 *
 * No API key. Politeness is the contract: a descriptive User-Agent and roughly
 * one query per second.
 */

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT =
  'Throughline/0.1 (personal media tracker; https://github.com/tjoyarzun/throughline)';

export interface SparqlBinding {
  [key: string]: { type: string; value: string } | undefined;
}

export class WikidataClient {
  private lastRequest = 0;

  /** One query per second, measured from the last request rather than slept blindly. */
  private async throttle(): Promise<void> {
    const wait = 1000 - (Date.now() - this.lastRequest);
    if (wait > 0) await sleep(wait);
    this.lastRequest = Date.now();
  }

  async query(sparql: string): Promise<SparqlBinding[]> {
    await this.throttle();
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/sparql-results+json',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ query: sparql }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Wikidata ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { results: { bindings: SparqlBinding[] } };
      return json.results.bindings;
    }
    throw new Error('Wikidata query failed after 3 attempts');
  }

  /**
   * For a batch of IMDb ids, return adaptation sources, their authors, and
   * series membership.
   *
   * P345 imdb id · P144 based on · P50 author · P179 part of the series ·
   * P737 influenced by · P31 instance of
   */
  async filmFacts(imdbIds: string[]): Promise<SparqlBinding[]> {
    const values = imdbIds.map((id) => `"${id.replace(/"/g, '')}"`).join(' ');
    return this.query(`
      SELECT ?imdb ?basedOn ?basedOnLabel ?basedOnType ?basedOnTypeLabel
             ?author ?authorLabel ?series ?seriesLabel ?seriesType
             ?influencedBy ?influencedByLabel
      WHERE {
        VALUES ?imdb { ${values} }
        ?film wdt:P345 ?imdb .
        OPTIONAL {
          ?film wdt:P144 ?basedOn .
          OPTIONAL { ?basedOn wdt:P50 ?author . }
          OPTIONAL { ?basedOn wdt:P31 ?basedOnType . }
        }
        OPTIONAL {
          ?film wdt:P179 ?series .
          OPTIONAL { ?series wdt:P31 ?seriesType . }
        }
        OPTIONAL { ?film wdt:P737 ?influencedBy . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
    `);
  }
}

/**
 * Wikidata class QIDs mapped to core.work kinds.
 *
 * THERE IS NO DEFAULT, deliberately. The first version fell back to 'book' for
 * any unrecognized type, which quietly produced nonsense: "The Office is based
 * on the book The Office" (the source is the UK television series) and
 * "Chicago P.D. is based on the book Chicago Fire" (a spin-off of another
 * show). A missing edge is recoverable; a confidently wrong one poisons the
 * graph and the path finder will happily narrate it.
 */
export const WORK_KIND_BY_QID: Record<string, string> = {
  Q7725634: 'book', // literary work
  Q571: 'book', // book
  Q47461344: 'book', // written work
  Q8261: 'book', // novel
  Q1667921: 'book', // novel series
  Q747381: 'book', // light novel
  Q49084: 'short_story', // short story
  Q25379: 'play', // play
  Q7725310: 'book', // literary series
  Q1004: 'comic', // comics
  Q1760610: 'comic', // comic book
  Q8274: 'comic', // manga
  Q21198342: 'comic', // manga series
  Q1107: 'comic', // anime (as a source work)
  Q562061: 'comic', // comic strip
  Q7889: 'game', // video game
  Q11410: 'game', // game
  Q16510064: 'true_events', // sporting event
  Q1190554: 'true_events', // occurrence
  Q13418847: 'true_events', // historical event
  Q198: 'true_events', // war
  Q5: 'true_events', // human (a biopic's subject)
};

/**
 * Screen works. When P144 points at one of these the relationship is
 * title-to-title (a remake, a spin-off, an adaptation of another show) and
 * belongs in the title graph, NOT in core.work. Recorded explicitly so the
 * skip is a decision rather than a silent fallthrough.
 */
export const SCREEN_WORK_QIDS = new Set([
  'Q5398426', // television series
  'Q11424', // film
  'Q24856', // film series
  'Q1259759', // miniseries
  'Q581714', // animated series
  'Q63952888', // anime television series
  'Q220898', // TV film
  'Q506240', // television film
  'Q93204', // documentary film
  'Q202866', // animated film
  'Q3464665', // television season
]);

/**
 * Wikidata P179 ("part of the series") is used loosely. A live query returned
 * No Country for Old Men as part of "BBC's 100 Greatest Films of the 21st
 * Century" — a LIST, not a franchise. Accepting that would put editorial
 * listicles into the franchise graph and pollute part_of_franchise edges with
 * meaningless co-membership.
 *
 * So series membership is only accepted when the series is typed as an actual
 * series of works.
 */
export const FRANCHISE_SERIES_QIDS = new Set([
  'Q24856', // film series
  'Q196600', // media franchise
  'Q7725310', // series of creative works
  'Q1667921', // novel series
  'Q13593966', // literary trilogy
  'Q281643', // tetralogy
  'Q1665149', // trilogy
  'Q5398426', // television series
  'Q47461344', // written work (series of)
]);

export const qid = (uri: string | undefined): string | null =>
  uri ? (uri.split('/').pop() ?? null) : null;
