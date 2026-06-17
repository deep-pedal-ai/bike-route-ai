# POI Enrichment — Build Plan & Orchestration

> Execution plan for [`poi-enrichment-feature.md`](./poi-enrichment-feature.md).
> Tracer-bullet vertical slices, sequenced into phases an orchestrator runs by
> spawning subagents. **Every slice is built TDD** (red → green → refactor, one
> test → one impl; never all-tests-then-all-code). Contract-first so the three
> surfaces (pipeline / server / client) fan out in parallel.

## Orchestration DAG

```
PHASE A — Contract (sequential, 1 agent)        ← everyone builds against this
  S1  migration 003 + shared types (the seam)
  S2  POI taxonomy (pure fn: OSM tags → bucket)
        │
        ▼
PHASE B — Fan-out (parallel, ~6 agents, fixtures/mocks only — NO live DB/paid API)
  ── pipeline ──        ── server ──        ── client ──
  S3 Overpass+select    S8 detail JOIN      S9  map POI layer
  S4 Wikimedia images                       S10 detail-panel POI section
  S5 description fold
        │
        ▼
PHASE C — Integrate (sequential, 1–2 agents, against TEST Neon branch)
  S6  phase p6 wiring (S2+S3+S4 → upsert pois/route_pois + ingest_log)
  S7  p5 re-embed cascade (S5+S6 → changed descriptions re-embed)
        │
        ▼
PHASE D — Gated ops (HUMAN-APPROVED, sequential, no autonomous run)
  G1 apply migration to prod branch
  G2 run p6 against live corpus (Overpass + Wikimedia — free, external)
  G3 re-run p5 (PAID: ~149 OpenAI embeddings) → verify search + panel
```

**Parallelism rule:** Phase B agents never touch the live DB or a paid API — they
test against **fixtures** (the Overpass spot-check responses from §2a become
recorded fixtures) and the **type contract** from Phase A. This is what makes the
fan-out safe and deterministic.

**TDD rule for every agent:** vertical tracer bullets. Within a slice: write ONE
behavioral test through the public interface → minimal code to green → repeat.
No agent writes "all the tests" up front. Tests assert observable behavior, not
internal shape, so they survive a LangChain rework (the feature's #1 constraint).

---

## Issues (independently grabbable vertical slices)

Each issue lists its **public interface**, the **behaviors to test** (the red
tests, in order), dependencies, and surface. Estimit = rough size.

### S1 — Migration 003 + shared type contract  ·  *pipeline+shared* · blocks all
- **Interface:** `pois` + `route_pois` tables (DDL per feature doc §5); shared
  `PoiSummary` type; `CorpusRouteDetailProps.pois?: PoiSummary[]`.
- **Tests (TDD):** (1) migration applies on a **disposable Neon test branch** and
  both tables + `UNIQUE(osm_type,osm_id)` + FKs exist; (2) a `route_pois` row
  round-trips with a `pois` FK; (3) shared type compiles and a fixture object
  satisfies it.
- **Deps:** none. **Note:** applies only to a test branch — prod apply is G1.

### S2 — POI taxonomy (pure function)  ·  *pipeline* · blocks S3, S5, S6
- **Interface:** `bucket_for_tags(tags: dict) -> Bucket | None`; the 5-bucket
  whitelist + radius-per-bucket config.
- **Tests:** `{amenity:cafe}→coffee_food`; `{amenity:drinking_water}→water_rest`;
  `{tourism:viewpoint}→scenic`; `{historic:castle}→landmark`;
  `{amenity:bicycle_repair_station}→bike_services`; `{shop:supermarket}→None`.
- **Deps:** none. Pure, fixture-free — ideal first tracer bullet.

### S3 — Overpass fetch + selection policy  ·  *pipeline* · needs S2
- **Interface:** `select_pois(route_geom, cfg) -> list[SelectedPoi]` (with
  `distance_m`, `bucket`, `position_fraction`).
- **Tests (against recorded Overpass fixtures):** returns ≤15 total; ≤4 per
  bucket; respects 150 m stop / 400 m scenic radius; results spread by
  `position_fraction` (not clustered); within-bucket ranking prefers
  `wikidata`/`name`. HTTP is mocked.
- **Deps:** S2.

### S4 — Wikimedia image resolver  ·  *pipeline* · parallel
- **Interface:** `resolve_image(wikidata_id) -> ImageRef | None` (Commons
  filename + license + attribution).
- **Tests (fixtures):** wikidata → P18 → filename; returns `None` when no
  `wikidata` tag or no P18 (the common case — **not** an error).
- **Deps:** none.

### S5 — Description fold  ·  *pipeline* · needs S2 · embedding-coupling point
- **Interface:** extend `build_route_description(..., poi_summary=None)`.
- **Tests:** with POIs → description gains experiential category clause ("several
  coffee stops, a scenic overlook"); **with no POIs → byte-identical to today**
  (backward-compat for all 149 existing rows — guard against spurious re-embed);
  proper nouns never appear in the string.
- **Deps:** S2.

### S6 — Phase p6 wiring  ·  *pipeline* · needs S2,S3,S4,S1
- **Interface:** `run_p6(conn, cfg)` — for each route: select → resolve images →
  upsert `pois`/`route_pois` → write `ingest_log`.
- **Tests (TEST Neon branch + fixtures):** populates `route_pois` for a seeded
  route; **idempotent** — re-run within freshness window skips (`last_refreshed_at`);
  writes `zero_pois` log row for a route with no nearby POIs; Overpass failure →
  `error` log row, not a crash.
- **Deps:** S1–S4.

### S7 — p5 re-embed cascade  ·  *pipeline* · needs S5,S6
- **Interface:** none new — verify existing p5 idempotency under p6 output.
- **Tests:** after p6 changes a description, p5 re-embeds **only** that row and
  skips unchanged rows; single-embedding-model invariant still holds.
- **Deps:** S5, S6.

### S8 — Server detail read-path  ·  *server* · needs S1 contract
- **Interface:** `GET /api/corpus/routes/:id` response gains `pois[]`.
- **Tests (supertest, seeded fixture/test branch):** response includes `pois`
  ordered by `position_fraction`, each with name/category/lat/lng/image fields;
  route with no POIs returns `pois: []`; **the search path (`/routes/search`) is
  unchanged** (regression test).
- **Deps:** S1. Parallel with pipeline.

### S9 — Client map POI layer  ·  *client* · needs S1 contract (mockable)
- **Interface:** POI MapLibre source+layer keyed to the selected route.
- **Tests (vitest/RTL):** given a route detail with `pois`, a `pois` source is
  added and pins are colored by bucket; clearing selection removes the layer.
- **Deps:** S1 type (mock the response).

### S10 — Client detail-panel POI section  ·  *client* · needs S1 contract
- **Interface:** new `<section>` in `RouteDetailPanel`.
- **Tests (RTL):** renders POIs grouped by bucket with icon+name+distance; shows
  an image thumb **only** when `image` present (most won't — §2a); "View on
  Google Maps" href is `?api=1&query=LAT,LNG`; empty `pois` renders nothing.
- **Deps:** S1 type.

---

## Subagent assignment

| Phase | Agents (parallel within phase) | Isolation |
|---|---|---|
| A | 1× `S1+S2` (contract owner) | working tree |
| B | `S3` ‖ `S4` ‖ `S5` ‖ `S8` ‖ `S9` ‖ `S10` (6×) | worktree each (parallel file writes) |
| C | 1× `S6` → 1× `S7` (sequential) | working tree, TEST branch |
| D | **human-driven**, I assist step-by-step | prod |

Phase B uses isolated git worktrees per agent (they write different packages, but
worktree isolation prevents lockfile/index races). Each agent returns its diff +
test results; I review and integrate between phases.

---

## Human gates (never run autonomously)

1. **G1 apply migration to prod** — schema change on the live `routes` DB.
2. **G2 run p6 on live corpus** — external Overpass/Wikimedia calls (free).
3. **G3 re-run p5** — **paid** OpenAI re-embedding of ~149 rows (small but real).
4. **Rotate the exposed `DATABASE_URL`** before any of the above.

Verification after D: a query like *"flat ride with a coffee stop"* ranks
POI-coffee routes higher than before (embedding fold works), and the detail panel
shows pins. That's the end-to-end acceptance test.
