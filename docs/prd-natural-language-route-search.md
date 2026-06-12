# PRD: Natural-Language Route Search (RAG)

> Status: ready-for-agent · Produced locally (not published to the issue tracker, per request)
> Source: grilling session 2026-06-11 adopting `corpus-pipeline/docs/embeddings-plan.md` (PR #6 branch) as the binding spec.

## Problem Statement

A rider opens Freewheel and knows the kind of ride they want — "a flat, mostly paved ride away from traffic, around 20 km" — but the app cannot understand that sentence. Today's search is a client-side keyword matcher over hardcoded mock routes: it ignores the real 149-route corpus sitting in the database, fails on any phrasing it wasn't hand-coded for, and returns fabricated route details. Riders cannot find real routes that match the *experience* they're describing (terrain, surface, traffic protection) combined with the *constraints* they state (distance, loop).

## Solution

The rider types a free-form sentence and gets back the three real corpus routes that best match it, ranked, each with a short explanation of why it fits their ask. Hard constraints in the query (distance, loop) are honored as exact filters; the qualitative part of the query (hilly/flat, gravel/paved, protected/greenway) is matched semantically via embeddings. When no route satisfies the hard constraints, the app says so honestly and shows the closest alternatives instead of a dead end. Every number the rider sees (distance, elevation) comes verbatim from the corpus — never from a language model.

## User Stories

1. As a rider, I want to describe my ideal ride in plain English, so that I don't have to learn filter UI or keywords.
2. As a rider, I want results drawn from the real route corpus, so that every result is an actual rideable route and not mock data.
3. As a rider, I want the top 3 matches ranked best-first, so that I can compare a few good options instead of trusting a single black-box pick.
4. As a rider, I want a short blurb on each result explaining why it matches my query, so that I can choose between the three without re-reading raw stats.
5. As a rider, I want a stated distance like "around 25 miles" treated as a real filter, so that I don't get a 5 km ride that merely *sounds* long.
6. As a rider, I want "loop" or "out-and-back" in my query respected, so that I end where I started when I need to.
7. As a rider, I want qualitative asks — "hilly", "gravel", "away from traffic", "waterfront greenway" — matched on the riding experience, so that phrasing variations still find the right routes.
8. As a rider, I want to be told when no route satisfies my exact constraints and shown the closest alternatives, so that I'm never left with an empty screen.
9. As a rider, I want the distance and elevation shown on each card to be the route's true recorded values, so that I can trust the numbers when planning.
10. As a rider, I want a loop badge and a difficulty label derived from the route's real stats, so that I can size up each option at a glance.
11. As a rider, I want a surface breakdown bar on each card, so that I can see paved-vs-gravel mix without reading prose.
12. As a rider, I want the quick-query chips to keep working, so that I can one-tap common searches.
13. As a rider, I want a loading state while the search runs, so that I know the app is working.
14. As a rider, I want a clear error message when search fails, so that I know to retry rather than assume there are no routes.
15. As a rider, I want routes with missing elevation data to still appear (without a fake elevation number), so that good routes aren't hidden by data gaps.
16. As a corpus maintainer, I want each route's embedded description stored alongside its vector, so that the corpus is auditable and re-embeddable without re-deriving anything.
17. As a corpus maintainer, I want every embedded row tagged with the model that produced it, so that a future model swap can detect stale rows.
18. As a corpus maintainer, I want a guard forbidding mixed-model vectors in the corpus, so that similarity scores are never computed across incompatible vector spaces.
19. As a corpus maintainer, I want the embedding backfill to be idempotent, so that re-running it after a partial failure or description change is safe.
20. As a corpus maintainer, I want a ranking acceptance gate of hand-labelled queries, so that a description-template change or model swap that degrades ranking fails loudly.
21. As a developer, I want the serving app to connect with a read-only database role, so that the serving path physically cannot mutate or drop the corpus.
22. As a developer, I want schema ownership to stay with the pipeline's migration system, so that there is exactly one source of DDL truth.
23. As a developer, I want CI to run fully offline with all OpenAI and database calls mocked, so that builds are fast, deterministic, and free.
24. As a developer, I want a drift smoke test against a real database, so that a pipeline-side column change is caught before it breaks production queries.
25. As an operator, I want the chat model set by environment variable, so that model upgrades need no code change.
26. As an operator, I want per-search OpenAI cost in the fractions-of-a-cent range, so that the feature can run without budget approval.

## Implementation Decisions

**Adopted spec.** The embeddings plan written into PR #6 (`embeddings-plan.md`) is the binding contract: deterministic description template, additive migration, exact-scan vector search with **no ANN index** at this corpus size (~150 routes), and a ranking acceptance gate. ADR-0001 (pipeline and serving app share only the database) and ADR-0004 (embeddings deferred to a dedicated migration) are respected.

**Split of ownership (two PRs).**
- *Index-time (Python, corpus-pipeline — PR-A):* a new `phase5` pipeline phase owns migration 002 (`CREATE EXTENSION vector`; add `description`, `embedding vector(1536)`, `embedding_model` to `routes`), generates descriptions, embeds them, and backfills all 149 rows. Built atop PR #6's branch since it is unmerged.
- *Query-time (TypeScript, serving app — PR-B):* a new search endpoint plus client UI. The serving app never performs DDL and connects via a dedicated read-only role.

**Embedding model.** OpenAI `text-embedding-3-small`, 1536 dimensions, recorded as `model_id = openai:text-embedding-3-small` on every row. Dimension is fixed at migration time; switching models means a full re-embed (cheap at this corpus size). Mixed-model corpora are forbidden and guarded by a runtime assertion.

**What gets embedded.** A generated natural-language description per route — qualitative terrain (from ascent + distance), surface (from the surface breakdown), and protection/safety (from protected-lane and greenway fractions). Deliberately **excluded** from the embedding: exact distances, loop-vs-out-and-back, coordinates, and proper names — hard constraints belong in SQL filters, names in keyword search. Descriptions are produced by a deterministic pure function over stored columns (no LLM at index time) and stored for auditability. Routes with NULL ascent simply omit terrain wording.

**Query-time pipeline (one search = three OpenAI calls).**
1. *Constraint extraction:* one structured-output chat call parses the query into `{ minKm?, maxKm?, isLoop? }`. Only `distance_km` and `is_loop` are filterable in v1 (both fully populated; ascent is not).
2. *Query embedding:* the raw query is embedded with the same model as the corpus.
3. *Retrieval:* exact cosine scan — `WHERE embedding IS NOT NULL` plus extracted filters, ordered by cosine distance, limit 5.
4. *Relaxation fallback:* if the filtered scan returns zero rows, rerun once without filters and set `filtersRelaxed: true` so the UI can say "no exact match; closest rides shown".
5. *Rerank + blurbs:* one structured-output chat call sees the query and all 5 candidates (facts + descriptions) and returns the best 3 **in order** with a query-aware blurb each.

**Grounding rules.** The LLM writes prose only. All numbers shown to the rider come verbatim from database columns. The reranker may only reference the candidate IDs it was given; any out-of-set ID is rejected server-side, falling back to cosine order with the stored description as blurb. The same fallback applies if the rerank call fails.

**Chat model.** `gpt-4.1-mini` for both extraction and rerank, configured via a single environment variable so it can be swapped without code changes.

**API contract.** A POST search endpoint accepting `{ query: string }` (non-empty, length-capped) and returning (type shape from the design session):

```ts
type RouteSearchResult = {
  id: string; name: string;
  distanceKm: number; ascentM: number | null;
  isLoop: boolean; qualityScore: number | null;
  surfaceBreakdown: Record<string, number> | null;
  blurb: string;
};
type RouteSearchResponse = { results: RouteSearchResult[]; filtersRelaxed: boolean };
```

Errors follow the repo standard `{ error, statusCode }` shape; existing route types are left untouched.

**Server modules (deep modules first).**
- *Route-search service* — the deep module: the whole pipeline (extract → embed → retrieve → relax → rerank → validate → merge) behind a single `search(query)` interface, with no Express types, testable entirely with mocked collaborators.
- *OpenAI client* — encapsulates all prompt and structured-output details behind three methods: embed a query, extract constraints, rerank candidates.
- *Database client* — Drizzle in **query-only mode**: a hand-written mirror schema declaring only the columns the server reads, with the pgvector column type and cosine-distance helper; drizzle-kit is never used — the pipeline's migrations remain the sole DDL owner. Drift is caught by an integration smoke test.
- *Controller + route* — thin: validate the request body, call the service, forward errors per the repo's error-handling standard.

**Client modules.** An API wrapper for the search endpoint; a result-card list (name, distance with mi conversion, elevation when present, loop badge, derived difficulty, blurb, surface bar) replacing the single rich-route view; a relaxed-filters notice; existing search bar, quick queries, and loading skeleton retained. The keyword matcher and mock-route data are deleted.

**Secrets and roles.** Server env: read-only `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`. Pipeline env keeps the DDL-capable owner connection. The read-only role is created once via the Neon console (SELECT on `routes` only).

## Testing Decisions

**Philosophy.** Test external behavior at module boundaries, never implementation details: the service is tested through `search(query)` with mocked OpenAI/DB clients; the API through HTTP request/response shapes; the description generator through input-columns → output-prose pairs. Prompt wording, SQL text, and internal call order are not asserted.

**Offline unit suite (runs in CI, no network).**
- Description generator (Python): determinism, qualitative wording thresholds, and the exclusion rules (no numbers, no names, no coordinates) — the highest-value pure-function tests in the feature.
- Phase 5 backfill logic (Python): idempotency and the mixed-model guard, using a fake embedder.
- Route-search service (TS): filter flow, zero-result relaxation, out-of-set ID rejection, rerank-failure fallback, fact/blurb merging — all with mocked clients.
- Endpoint (TS): supertest against the Express app with a mocked service — success shape, validation 400, error shape. Prior art: the existing routes supertest suite.
- Client (TS): mocked fetch — loading, three cards rendered, relaxed-filters notice, error state. Prior art: the existing App component test.

**Env-gated integration gates (skipped when credentials are absent; run manually before sign-off).**
- *Ranking acceptance gate* (pytest, spec §5): ~6 hand-labelled queries against the real corpus + real embeddings; assert each known-good route lands in top-5 and at least one discriminating pair orders correctly (hilly-gravel query ranks a carriage-roads route above a flat greenway, and vice versa).
- *Schema drift smoke test* (TS): one real SELECT through the mirror schema against a dev database.

## Out of Scope

- Turn-by-turn directions and gear tips — no honest data source exists (the corpus stores geometry, not street-level directions); rendering them would mean hallucination. The old mock-driven rich view is removed.
- Filtering on elevation/ascent — too many NULLs in v1.
- ANN indexes (HNSW/IVFFlat) — explicitly forbidden by the spec until the corpus grows by orders of magnitude.
- Elevation backfill from an external elevation API (noted as the one future external-source opportunity).
- Map rendering of route geometry, pagination, auth/rate limiting, streaming responses, query-embedding caching, multi-turn conversational refinement.
- Merging PR #6 itself; this work builds on top of it.

## Further Notes

- No new external *data* sources are required: the corpus is complete (149 routes) and descriptions derive entirely from stored columns. The only external dependency is the OpenAI API.
- Cost envelope: full-corpus embed ≈ fractions of a cent; per-search ≈ hundredths of a cent (two mini-tier chat calls + one embedding).
- Sequencing: PR-A must be run against the database (backfill + passing ranking gate) before PR-B's endpoint returns useful results; the two can be *reviewed* in parallel.
- The pipeline's `Embedder` protocol keeps a local-model swap possible later, but any swap is a full re-embed plus migration of the vector dimension.
