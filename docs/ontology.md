# Ontology

The compiled predicate and entity tables are in [ontology-reference.md](ontology-reference.md),
which is **generated** from `ontology/ontology.yaml`. This file holds the _reasoning_.

## The governing distinction

Every concept in the domain resolves to exactly one of six categories, and the category determines
the implementation:

| Category         | Definition                                                                 | Implementation                                         | Examples                                                 |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| **Entity**       | Independent identity; subject of many statements; persists across contexts | Own table + UUID + external IDs                        | Title, Person, Character, Organization, Collection, Work |
| **Part**         | Identity only within a parent; composition                                 | Table with mandatory FK; addressable, not a graph node | Season, Episode                                          |
| **Concept**      | A term in a controlled vocabulary                                          | Row in `core.concept`, discriminated by `scheme`       | Genre, Theme, Mood                                       |
| **Role**         | A way a person participates in a work                                      | The **predicate**, plus job/department attributes      | Actor, Director, Writer                                  |
| **Attribute**    | A scalar intrinsic to one entity                                           | A column                                               | runtime, release_date, budget                            |
| **Relationship** | A typed directed statement linking two entities                            | Row in `core.credit` / `core.edge`                     | directed, explores_theme                                 |

Roles as predicates is [ADR 0002](adr/0002-person-entity-roles-as-predicates.md).

## Genre vs. Theme — same shape, different weight

Genre is provider-supplied, coarse, and familiar (19 TMDB values). Theme is our curated,
fine-grained, editorially-defended vocabulary. They share `core.concept` because they behave
identically _structurally_ — hierarchical, many-to-many with titles, tappable — but differ
completely in provenance and in path-finding weight.

Genre edges are nearly worthless for explaining a connection ("both are Drama"); theme edges are the
most interesting non-credit edges in the graph. Same shape, different weight — which is exactly why
the weight belongs in `ontology.yaml` rather than being implied by table structure.

## Character is an entity, not a string

Tempting to store `character_name` on the credit and move on. But Rick Deckard appears in two films
played by one actor; James Bond appears in 25 played by six; the Joker crosses continuities.
Character-as-entity makes "which actors have played Batman?" a one-hop query and enables
`Person --portrays--> Character --appears_in--> Title` paths, which are among the most delightful
results the path finder produces.

The cost is entity resolution on character names, which is genuinely hard. MVP policy is
conservative: resolve only when the credit has a non-empty character name **and** either the title
belongs to a collection where that normalized name already exists, or it matches a curated seed list
of ~300 notable recurring characters. Otherwise `character_name_raw` stays on the credit and
`character_id` is null. The UI renders "as Officer K" either way; the user cannot tell.

**A `resolved_character_pct` metric is displayed publicly in the Universe panel.** Showing the
coverage gap is more impressive than hiding it, and it is exactly what a data reviewer looks for.

## What we deliberately did not model

Knowing what to leave out is the harder half.

- **FRBR Work/Expression/Manifestation/Item.** Correct for libraries, catastrophic here — it would
  triple the entity count to distinguish theatrical cut from director's cut from 4K release. One
  `title`; cuts are an attribute. Revisit only if cut-level tracking is requested.
- **Awards** in MVP. Phase 2 as an `award` entity plus a **reified `nomination`** — a nomination has
  attributes (year, category, won/lost) and links three entities, so it is a genuine n-ary
  relationship deserving reification, not an edge.
- **Reviews and criticism** as entities. No.
- **A `collaborated_with` person-to-person edge.** Fully derivable, O(n^2) in cast size (a 30-person
  cast yields 435 edges; 5,000 titles would produce ~2M junk edges), and materializing it destroys
  the _reason_ for the collaboration, which is what narration needs. Person-to-person connections
  are found as 2-hop paths through a title. Where performance demands it (Bacon numbers) we
  materialize a purpose-built projection instead — targeted denormalization, not speculative.
- **Time-varying edges generally.** `valid_from`/`valid_to` exist on `core.edge` but are unused in
  MVP except for organizational restructuring.

## Expansion rule

A new predicate is justified only when:

1. it cannot be expressed as an attribute on an existing predicate, **and**
2. at least one real query or UI surface needs it, **and**
3. a data source can populate it for more than 20% of the corpus.

Predicates failing (3) become curated-only and are flagged `sparse: true`, which the Universe UI
surfaces. Twenty-one predicates today. Adding one means editing `ontology/ontology.yaml`, running
`pnpm codegen`, and appending to the changelog below.

## Theme vocabulary

`ontology/themes.yaml` — 98 themes across 14 clusters, each with a definition. This is an
**editorial position**, not provider data.

TMDB keywords are not themes. They are a ~40k-term folksonomy mixing settings ("new york city"),
objects ("robot"), plot devices ("time loop"), and tone ("dystopia"). A serious ontology does not
adopt a folksonomy wholesale.

**Derivation process:**

1. Extract the keyword frequency distribution across the corpus (~8,000 distinct keywords; the top
   400 cover ~70% of assignments).
2. Map keywords to themes in `core.crosswalk_keyword_theme` with a salience weight. Many-to-many;
   **most keywords map to zero themes**, which is correct — a setting is not a theme.
3. LLM-assisted, human-reviewed. Every row carries `decided_by` = `llm_draft` or `human`. Rows still
   marked `llm_draft` are visible in the admin view and reviewed opportunistically.
4. For each title, aggregate its keywords' mapped themes, sum salience, keep those above threshold,
   cap at 6 per title.

Because `raw` retains the payloads, revising the vocabulary re-derives all theme edges in one
command. That replayability is why `raw` exists.

### Theme changelog

| Date       | Change                                                                                                                         | By                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| 2026-09-20 | v1 draft: 14 clusters, 98 themes. **Awaiting editorial review before Phase 2 derives edges at corpus scale.** Budget ~2 hours. | Claude, for Tommy |
