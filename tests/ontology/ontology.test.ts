import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  PREDICATES,
  PREDICATE_SPECS,
  ENTITY_TYPES,
  TRAVERSABLE_PREDICATES,
  PATH_WEIGHTS,
  GRAPH_NODE_TYPES,
} from '@/lib/ontology/generated';

const onto = parse(readFileSync('ontology/ontology.yaml', 'utf8'));
const themes = parse(readFileSync('ontology/themes.yaml', 'utf8'));
const metrics = parse(readFileSync('ontology/metrics.yaml', 'utf8'));
const moods = parse(readFileSync('ontology/moods.yaml', 'utf8'));
const baseType = (t: string) => t.split(':')[0]!;

describe('ontology <-> generated artifacts', () => {
  it('generated predicate list matches the yaml exactly', () => {
    expect([...PREDICATES].sort()).toEqual(Object.keys(onto.predicates).sort());
  });

  it('generated entity types match the yaml exactly', () => {
    expect([...ENTITY_TYPES].sort()).toEqual(Object.keys(onto.entity_types).sort());
  });
});

describe('predicate declarations', () => {
  it.each(PREDICATES)('%s declares a valid domain and range', (name) => {
    const p = PREDICATE_SPECS[name];
    expect(p.domain.length).toBeGreaterThan(0);
    expect(p.range.length).toBeGreaterThan(0);
    for (const t of [...p.domain, ...p.range]) {
      expect(ENTITY_TYPES as readonly string[]).toContain(baseType(t));
    }
  });

  it.each(PREDICATES)('%s declares an inverse', (name) => {
    expect(PREDICATE_SPECS[name].inverse).toBeTruthy();
  });

  it.each(PREDICATES)('%s has a grammatical narration template', (name) => {
    const p = PREDICATE_SPECS[name];
    expect(p.narration).toContain('{subject}');
    expect(p.narration).toContain('{object}');
    // Rendering with real values must not leave an unsubstituted placeholder.
    const rendered = p.narration
      .replace('{subject}', 'Arrival')
      .replace('{object}', 'Denis Villeneuve');
    expect(rendered).not.toMatch(/\{[a-z_.]+\}/);
    expect(rendered.length).toBeGreaterThan('Arrival Denis Villeneuve'.length);
  });

  it('symmetric predicates are their own inverse', () => {
    for (const name of PREDICATES) {
      const p = PREDICATE_SPECS[name];
      if (p.symmetric) expect(p.inverse).toBe(name);
    }
  });

  it('every predicate is stored somewhere the schema knows about', () => {
    const valid = ['core.credit', 'core.edge', 'core.edge_derived', 'structural'];
    for (const name of PREDICATES) expect(valid).toContain(PREDICATE_SPECS[name].storage);
  });

  it('only derived predicates live in core.edge_derived', () => {
    for (const name of PREDICATES) {
      const p = PREDICATE_SPECS[name];
      if (p.storage === 'core.edge_derived') expect(p.provenance).toContain('derived');
      if (p.provenance.includes('derived') && p.storage !== 'core.edge')
        expect(p.storage).toBe('core.edge_derived');
    }
  });
});

describe('path ranking configuration', () => {
  it('structural predicates are excluded from traversal', () => {
    // Composition is not a connection. Including season_of would let the path
    // finder emit "Arrival -> Drama -> some episode of Breaking Bad".
    const structural = PREDICATES.filter((p) => PREDICATE_SPECS[p].structural);
    expect(structural.length).toBeGreaterThan(0);
    for (const s of structural)
      expect(TRAVERSABLE_PREDICATES as readonly string[]).not.toContain(s);
  });

  it('every traversable predicate has a path weight', () => {
    for (const p of TRAVERSABLE_PREDICATES) expect(PATH_WEIGHTS[p]).toBeTypeOf('number');
  });

  it('credit predicates outrank classification predicates', () => {
    // The whole point of weighting: "shares a director" must beat "both are Drama".
    expect(PATH_WEIGHTS.directed!).toBeLessThan(PATH_WEIGHTS.explores_theme!);
    expect(PATH_WEIGHTS.explores_theme!).toBeLessThan(PATH_WEIGHTS.belongs_to_genre!);
    expect(PATH_WEIGHTS.directed!).toBeLessThan(PATH_WEIGHTS.produced_by!);
  });

  it('genre is excluded from intermediate positions outright', () => {
    expect(PREDICATE_SPECS.belongs_to_genre.excludedFromPathIntermediates).toBe(true);
  });
});

describe('concept schemes and the theme vocabulary', () => {
  it('every concept range references a declared scheme', () => {
    const schemes = Object.keys(onto.concept_schemes);
    for (const name of PREDICATES) {
      for (const r of PREDICATE_SPECS[name].range) {
        if (baseType(r) === 'concept' && r.includes(':'))
          expect(schemes).toContain(r.split(':')[1]);
      }
    }
  });

  it('the curated theme vocabulary is in the target size range', () => {
    const all = Object.values(themes.clusters).flatMap((c: any) => Object.keys(c.themes));
    expect(all.length).toBeGreaterThanOrEqual(90);
    expect(all.length).toBeLessThanOrEqual(140);
  });

  it('covers the dimensions a keyword census showed were missing', () => {
    // A census of 448 top-rated and popular titles found substantial keyword mass
    // with no home in v1: supernatural/magic (151 assignments), superhero and
    // extraordinary power (121), rivalry and training (48), mental illness (27),
    // sexuality and gender (26), time travel (21). Each now has one.
    const all = Object.values(themes.clusters).flatMap((c: any) => Object.keys(c.themes));
    for (const required of [
      'magic_and_enchantment',
      'monsters_and_the_monstrous',
      'extraordinary_power',
      'secret_identity',
      'rivalry',
      'mental_illness',
      'sexual_identity',
      'time_travel',
      'dystopia',
      'prejudice_and_otherness',
    ]) {
      expect(all, `${required} closes a measured coverage gap`).toContain(required);
    }
  });

  it('theme slugs are globally unique across clusters', () => {
    const all = Object.values(themes.clusters).flatMap((c: any) => Object.keys(c.themes));
    expect(new Set(all).size).toBe(all.length);
  });

  it('no theme carries a stray key', () => {
    // Regression guard. themes.yaml was originally written with flow mappings
    // ({ label: X, definition: Y }), where an unquoted comma silently terminates
    // the value and turns the remainder into null-valued keys. Five definitions
    // were truncated that way. Block style fixed it; this keeps it fixed.
    for (const [cname, c] of Object.entries<any>(themes.clusters)) {
      for (const [tname, t] of Object.entries<any>(c.themes)) {
        expect(Object.keys(t).sort(), `${cname}.${tname} has unexpected keys`).toEqual([
          'definition',
          'label',
        ]);
      }
    }
  });

  it('every theme has a definition — a label alone is not a vocabulary', () => {
    for (const [cname, c] of Object.entries<any>(themes.clusters)) {
      for (const [tname, t] of Object.entries<any>(c.themes)) {
        expect(t.label, `${cname}.${tname}`).toBeTruthy();
        expect(t.definition?.length ?? 0, `${cname}.${tname} definition`).toBeGreaterThan(20);
      }
    }
  });
});

describe('the mood vocabulary', () => {
  it('every mood has a definition and both axes', () => {
    for (const [name, m] of Object.entries<any>(moods.moods)) {
      expect(m.label, name).toBeTruthy();
      expect(m.definition?.length ?? 0, `${name} definition`).toBeGreaterThan(20);
      expect(typeof m.valence, `${name} valence`).toBe('number');
      expect(typeof m.intensity, `${name} intensity`).toBe('number');
    }
  });

  it('valence and intensity stay in their declared ranges', () => {
    const [vMin, vMax] = moods.axes.valence.range;
    const [iMin, iMax] = moods.axes.intensity.range;
    for (const [name, m] of Object.entries<any>(moods.moods)) {
      expect(m.valence, `${name} valence`).toBeGreaterThanOrEqual(vMin);
      expect(m.valence, `${name} valence`).toBeLessThanOrEqual(vMax);
      expect(m.intensity, `${name} intensity`).toBeGreaterThanOrEqual(iMin);
      expect(m.intensity, `${name} intensity`).toBeLessThanOrEqual(iMax);
    }
  });

  it('spans the valence axis, so "less depressing" has somewhere to go', () => {
    // A vocabulary clustered at one end cannot answer the query it exists for.
    const v = Object.values<any>(moods.moods).map((m) => m.valence);
    expect(Math.min(...v)).toBeLessThan(-0.6);
    expect(Math.max(...v)).toBeGreaterThan(0.6);
    expect(v.filter((x) => x < 0).length).toBeGreaterThan(5);
    expect(v.filter((x) => x > 0).length).toBeGreaterThan(5);
  });

  it('separates quiet from loud at the same valence', () => {
    // Melancholy and Devastating are both negative; someone asking for one
    // rarely wants the other. Intensity is what tells them apart.
    const m = moods.moods;
    expect(m.melancholy.valence).toBeLessThan(0);
    expect(m.devastating.valence).toBeLessThan(0);
    expect(m.devastating.intensity - m.melancholy.intensity).toBeGreaterThan(0.4);
  });

  it('mood is declared as a concept scheme in the ontology', () => {
    expect(Object.keys(onto.concept_schemes)).toContain('mood');
  });
});

describe('metrics are declarative', () => {
  it('every metric declares grain, source, and measure', () => {
    for (const [name, m] of Object.entries<any>(metrics.metrics)) {
      expect(m.grain, name).toBeTruthy();
      expect(m.source, name).toMatch(/^sem\./);
      expect(m.measure, name).toBeTruthy();
    }
  });

  it('every metric sources from sem.* — never core, raw, or usr directly', () => {
    for (const [name, m] of Object.entries<any>(metrics.metrics)) {
      expect(m.source, `${name} must read the semantic layer`).not.toMatch(/^(core|raw|usr)\./);
    }
  });

  it('every metric transform is in the declared vocabulary', () => {
    for (const [name, m] of Object.entries<any>(metrics.metrics)) {
      if (m.transform) expect(metrics.transforms, name).toContain(m.transform);
    }
  });

  it('MVP ships exactly five phase-1 metrics', () => {
    const p1 = Object.values<any>(metrics.metrics).filter((m) => m.phase === 1);
    expect(p1).toHaveLength(5);
  });
});

describe('graph node types', () => {
  it('parts are not graph nodes', () => {
    // Seasons and episodes are composition children, addressable but not explorable.
    expect(GRAPH_NODE_TYPES as readonly string[]).not.toContain('season');
    expect(GRAPH_NODE_TYPES as readonly string[]).not.toContain('episode');
  });

  it('there is no separate Actor/Director/Writer entity type', () => {
    // Roles are predicates. This test is the guard against the classic regression.
    for (const forbidden of ['actor', 'director', 'writer']) {
      expect(ENTITY_TYPES as readonly string[]).not.toContain(forbidden);
    }
    for (const role of ['directed', 'wrote', 'acted_in']) {
      expect(PREDICATES as readonly string[]).toContain(role);
      expect(PREDICATE_SPECS[role as (typeof PREDICATES)[number]].domain).toContain('person');
    }
  });
});
