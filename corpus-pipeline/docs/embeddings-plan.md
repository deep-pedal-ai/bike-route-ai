Phase 5 implements this design with the OpenAI `text-embedding-3-small`
embedder, migration `002_embeddings.sql`, and the `phase5` CLI command. This
document remains the contract for the description template, model guard, exact
scan, and ranking acceptance gate.

---

## 0. Why this is deferred

Freewheel is ultimately a RAG recommender, so a reader expects a vector column —
there deliberately isn't one yet. The embedding strategy (hosted vs local model,
and therefore the vector dimension) is undecided, and provisioning of `pgvector`
is owned by a teammate and may lag the ingestion build. Migration `001` stays
plain PostGIS so Phases 1–4 run before any of that lands (ADR-0004).

---

## 1. Description template (what we embed)

We embed a **generated natural-language description** of each route, not the raw
geometry. The description is written so that semantically-similar rides land near
each other in vector space, while facts a user filters on *exactly* are left OUT
of the embedding (those belong in SQL `WHERE` clauses, not in fuzzy similarity):

**EXCLUDE from the description / embedding:**
- **Hard constraints** — exact distance in km, exact ascent in m, loop-vs-
  out-and-back. (A user asking for "a 40 km loop" wants a `WHERE distance_km
  BETWEEN ... AND is_loop` filter, not a route that merely *sounds* 40 km.)
- **Coordinates / waypoints** — never embed lat/lon. They carry no semantic
  meaning and pollute the vector.
- **Proper names** — route names, park names, street names. Embedding "Central
  Park" makes the model match on the string, not the riding experience; names go
  in a keyword/text index instead.

**INCLUDE in the description (in words, qualitative):**
- **Terrain** — flat / rolling / hilly / one big climb, described qualitatively
  from `ascent_m` + `distance_km` (e.g. "mostly flat with a short punchy climb").
- **Surface** — paved / mixed / gravel / rough, from `surface_breakdown` in
  words (e.g. "fully paved" vs "half crushed-gravel carriage roads").
- **Protection / safety** — protected lanes / greenway / mixed-traffic, from
  `protected_lane_fraction` + `greenway_fraction` in words (e.g. "almost entirely
  on a protected greenway" vs "shares the road with traffic in places").

Example (illustrative): *"A rolling, fully-paved ride that runs almost entirely
on a protected waterfront greenway away from traffic, with one short climb."*

The description is generated deterministically from the already-stored numeric
columns + breakdowns; it is stored in the new `description` column (see §3) so it
is auditable and re-embeddable without re-deriving it.

---

## 2. The `Embedder` protocol

A single protocol abstracts the embedding backend so hosted and local models are
swappable:

```python
from typing import Protocol

class Embedder(Protocol):
    """Turns a route description into a fixed-length vector."""

    #: The vector dimension this embedder produces. Fixed per embedder.
    dim: int
    #: A stable identifier stored on every row this embedder writes.
    model_id: str

    def embed(self, text: str) -> list[float]:
        """Return a ``dim``-length embedding for ``text``."""
        ...
```

Two concrete embedders are planned:

| Embedder | Where | `dim` | Example `model_id` |
|----------|-------|------:|--------------------|
| Hosted | API (e.g. OpenAI `text-embedding-3-small`) | **1536** | `openai:text-embedding-3-small` |
| Local | on-box (e.g. a MiniLM sentence-transformer) | **384** | `local:all-MiniLM-L6-v2` |

**Rules:**
- **The dimension is a config-time choice**, fixed before the first embedding is
  written. The `embedding` column is declared `vector(<dim>)` for that exact
  dimension; you cannot mix a 1536-d and a 384-d vector in one column.
- **Every row stores its `embedding_model`.** The `model_id` of the embedder that
  produced the vector is written alongside it, so the corpus is self-describing
  and a future re-embed can detect stale rows.
- **Mixed-model corpora are forbidden.** All rows in `routes.embedding` must come
  from the **same** embedder (same `model_id`, same `dim`). Cosine similarity
  across two different models' vector spaces is meaningless. Switching models
  means a full re-embed of every row, not a row-by-row mix. A pre-query assertion
  (`SELECT count(DISTINCT embedding_model) FROM routes WHERE embedding IS NOT
  NULL` must be `<= 1`) should guard this invariant at runtime.

---

## 3. The `ALTER TABLE` migration Phase 5 adds

This is migration `002` (or later), run **only** once the embedder + dimension
are chosen. `<dim>` is substituted with the chosen embedder's dimension (1536 or
384). It is additive — it does not touch any Phase 1–4 column.

```sql
-- Phase 5 migration. <dim> = the chosen embedder dimension.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE routes
    ADD COLUMN description     text,
    ADD COLUMN embedding       vector(<dim>),
    ADD COLUMN embedding_model text;
```

No ANN index is created (see §4).

---

## 4. No ANN index at this scale

`pgvector` supports IVFFlat / HNSW approximate-nearest-neighbour indexes, but the
corpus is **~150–250 routes**. A sequential exact scan over a few hundred vectors
is sub-millisecond and returns *exact* nearest neighbours; an ANN index would add
build/maintenance cost and approximation error for zero latency benefit at this
size. **Do not add an ANN index** until the corpus grows by orders of magnitude
(thousands+). Until then, query with a plain ordered exact scan:

```sql
SELECT id, name, embedding <=> :query_vec AS distance
FROM routes
WHERE embedding IS NOT NULL
ORDER BY distance
LIMIT :k;
```

---

## 5. Ranking acceptance test (the Phase-5 gate)

The acceptance criterion for Phase 5 is a **ranking test**, not just "embeddings
exist". Build a small set of hand-labelled query → expected-route expectations
and assert the expected route ranks at (or near) the top:

> Given the embedded corpus, for a query like *"flat protected waterfront ride,
> mostly paved, around 20 km"*, the Hudson River Greenway (or an equivalent
> flat/protected/greenway/paved route) MUST appear in the top-k results; and for
> *"hilly gravel ride away from traffic"*, a Rockefeller carriage-roads /
> Old Croton Aqueduct type route MUST rank above a flat city greenway.

Concretely, the test:
1. embeds a fixed list of natural-language queries,
2. runs the §4 query for each,
3. asserts each query's known-good route is within top-k (e.g. k=5), and
4. asserts at least one **discriminating pair** orders correctly (the gravel-hilly
   query ranks a gravel-hilly route above a flat-paved one, and vice-versa),

so a regression in the description template or a model swap that degrades ranking
fails the gate. This is a behavioural test on similarity *ordering*, deliberately
tolerant of exact distances (which the embedding excludes, per §1).
