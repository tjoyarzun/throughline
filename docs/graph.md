# Graph

## Three modes, one engine

**A force-directed hairball is a bad product on a phone.** It is illegible below ~40 nodes of screen
area, it fights browser pan and zoom, and it answers no question. So the graph has three modes and
only one of them is a force graph.

| Mode              | Default on | Rendering                                         | Purpose                                                                                                                                                                                                                                |
| ----------------- | ---------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Focus**         | mobile     | SVG + CSS transforms                              | Orbit layout: selected entity centered, neighbors in arcs grouped and labeled by predicate. Hard cap 32 visible, ranked by edge weight x popularity, "+N more" per group. Tap re-centers with a spring; a breadcrumb records the walk. |
| **Path**          | all        | Vertical chain of node cards + labeled connectors | Readable as a sentence, thumb-scrollable, screenshot-friendly. Up to 3 ranked paths, each with a narration line.                                                                                                                       |
| **Constellation** | >= 1024px  | Sigma.js v4 + graphology, WebGL                   | The full force graph. Filters by node type and predicate, ForceAtlas2 in a **web worker with a fixed iteration budget** — never an indefinitely-running simulation. Node cap 600.                                                      |

Focus and Path ship first and need no WebGL, which means the Universe is shippable before any graph
library enters the bundle.

## Library choice

**Sigma.js v4 + graphology**, for Constellation only. graphology is the right _data model_
regardless — typed attributes, traversal and layout algorithms, serializable, and it mirrors
`sem.edge` almost exactly. Sigma is WebGL and handles far more nodes than we will render.

Rejected: **Cytoscape.js** (DOM/canvas, documented multithreading limitation that hurts on mobile;
its strength is its algorithm library, which we do not need client-side because path finding runs in
Postgres), **React Flow** (node editors, not knowledge graphs), **raw D3** (more work, worse mobile
result).

**The graph library is dynamically imported and CI-asserted absent from the shared bundle.** This
single rule protects the tracker's performance from the portfolio feature.

## Path finding

The algorithm and its rationale are in [ADR 0010](adr/0010-hub-penalized-path-ranking.md). Summary:

```
cost(edge) = predicate_weight x hub_penalty(intermediate) x (1/confidence) x attribute_modifier
hub_penalty(n) = 1 + 0.45 * ln(1 + degree(n))
ban intermediates with degree > 2000; exclude belongs_to_genre intermediates outright
```

Bidirectional expansion, depth <= 3 per side, as **explicit depth-1/2/3 joins unioned** — not a
recursive CTE. Frontier cap 4,000 per side. Top 3 after diversity filtering (reject >50% intermediate
overlap). Narration composed from ontology templates; no model involved.

Tuning constants live in `ontology/ontology.yaml` under `path_ranking` and are compiled into
`PATH_RANKING`.

**Budget:** p95 < 150ms warm on the MVP corpus. Cached by unordered pair in `core.path_cache`,
7-day TTL, invalidated when either endpoint's edges change.

## Kevin Bacon

Same machinery, predicate set constrained to `{acted_in}`. `core.person_bacon` is materialized
weekly by iterative BFS from Bacon's node (~15 lines, converges in 4 rounds).

It required no new predicate, no new entity type, and one purpose-built table — that it falls out
for free is the point worth making in the UI copy. It stays an Easter egg and must not distort the
ontology.

## Personal graph

`/universe/me` uses the **same SVG orbit renderer** as Focus mode — a deliberate economy, no new
rendering code. User node centered; rings of top directors, actors, themes, franchises by
`sem.user_taste_affinity`. Radius proportional to `n_titles`, fill by `avg_rating` on a diverging
scale.

A toggle overlays global neighbors desaturated, so the user sees coverage against the wider graph:
_"you have seen 4 of Villeneuve's 11."_ That single visual is the clearest statement of the
personal-layer-over-global-ontology thesis.

## Accessibility

Every graph view has a **list equivalent** reachable by a toggle and used by screen readers: Focus
renders as a grouped definition list, Path as an ordered list with the narration as accessible text.
Arrow keys move between neighbors, Enter re-centers, Escape returns.

This costs little because Focus and Path are SVG/DOM, not canvas — another reason WebGL is not the
default. Constellation is explicitly **not** made accessible; it offers a one-tap switch to Focus,
documented as the conforming alternative version.
