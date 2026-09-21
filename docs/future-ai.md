# Future AI

**Not in MVP.** Three decisions made now keep the door open at near-zero cost.

## 1. The semantic layer is the tool surface

Agents get **parameterized semantic queries**, never free-form SQL and never raw provider data.
`src/lib/ai/tools/` would expose a registry generated from `ontology.yaml` + `metrics.yaml`:

```
find_titles({ themes?, genres?, people?, exclude_watched?, min_rating?,
              max_runtime?, mood_exclude?, decade?, limit })
explain_connection({ a, b })          -> the existing path finder
describe_taste({ dimension })         -> sem.user_taste_affinity
list_user_titles({ status, sort, limit })
find_gaps({ dimension })              -> under-watched analysis
```

Each tool is a typed function over `sem.*` with the account scope injected server-side. The model
never sees SQL and cannot express an unscoped query.

This is both the safe design (no injection surface, no cross-tenant leakage, per-tool authorization
— OWASP LLM06 / ASI02) and the _demonstrable_ one: the ontology literally becomes the agent's
vocabulary. Parameter descriptions are generated from the ontology's concept labels and definitions,
so the agent's understanding of "theme" is the same object the database enforces.

## 2. Embeddings over composed semantic documents

Phase 3 adds `pgvector` with an embedding per title computed from a **constructed** document —
title, genres, curated themes with salience, director, top-3 cast, franchise, source work, tone
descriptor — **not** the provider's overview blob.

That is what makes _"like Arrival but less depressing"_ tractable: the vector captures the
ontological profile, and "less depressing" is a filter on a `mood` concept scheme, not a vibe the
embedding has to infer. Hybrid retrieval: vector similarity intersected with structured graph
constraints.

## 3. Grounding and provenance

Every answer cites the entities and edges it used, rendered as tappable chips into the Universe.
**The model never states a count it did not receive from a tool result.** Model choice when built:
`claude-sonnet-5` for routing and tool calls, `claude-opus-5` for synthesis.

## Why this matters for the portfolio

"I built an ontology, then made it an agent's tool vocabulary" is materially stronger than "I called
an LLM with some movie JSON" — and here it is the natural consequence of the architecture rather
than a bolt-on.

Security controls are pre-committed in [security.md](security.md#phase-3-ai-controls--pre-committed).
