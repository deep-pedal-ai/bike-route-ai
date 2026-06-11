# Build Plan — Freewheel Corpus Pipeline

**Audience:** an *orchestrator agent* that dispatches each work package below to a
*subagent* (Opus is acceptable for subagents) and enforces the gate between them.
**Method:** test-driven development, vertical slices.
**Decisions this plan implements:** [`DECISIONS.md`](./DECISIONS.md) + ADRs in
[`adr/`](./adr/). Read those first; do not relitigate them.

---

## 1. Orchestration model

```
        ┌─────────────────────────────────────────────┐
        │  ORCHESTRATOR (owns sequence, gates, log,     │
        │  branch hygiene, Neon lifecycle, commits)     │
        └───────────────┬───────────────────────────────┘
                        │ dispatches one work package at a time
                        ▼
        ┌─────────────────────────────────────────────┐
        │  SUBAGENT (Opus) — executes ONE work package  │
        │  with strict TDD, returns a structured report │
        └─────────────────────────────────────────────┘
```

**Orchestrator responsibilities**
1. Dispatch work packages in dependency order (see §6). Never start a WP whose
   gate-predecessors haven't passed.
2. After each subagent returns, **independently verify the gate** (§5) — run the
   tests and the Neon verification itself; do not trust the report alone.
3. On gate failure, dispatch a *fix* subagent with the exact failure output;
   retry up to 3× before escalating to the human. **Distinguish a real failure
   from an expected pause/skip** — these are NOT gate failures and must not enter
   the retry loop (see §11): an ORS daily-quota exit-0, canon entries skipped for
   distance > ±25% (DRAFT coords await human verification), and an empty `usbrs`
   source (GPX is manually downloaded and absent in an unattended build).
4. Commit on `feat/corpus-pipeline` after each green gate (one commit per WP).
5. Tick the WP checkbox in this file and append an orchestrator entry to
   [`BUILD-LOG.md`](./BUILD-LOG.md).
6. Own the Neon branch lifecycle (§9): create before WP0 gate, tear down after
   WP5 gate.

The orchestrator **does not write feature code.** It writes only: commits, this
file's checkboxes, and BUILD-LOG orchestrator entries.

**Subagent responsibilities** — see the brief template in §7. Each subagent owns
exactly one WP, works only inside `corpus-pipeline/`, follows the TDD protocol
(§4), appends to BUILD-LOG as it goes, and returns the structured report (§7).

---

## 2. Shared invariants (inject into every subagent brief)

- Work **only** inside `corpus-pipeline/`. Touch nothing else in the repo. (AC#5)
  The serving app is **real and live** (`packages/{shared,server,client}`, an
  npm-workspaces monorepo). Do **not** modify any `packages/**`, the root
  `package.json`, `tsconfig.base.json`, eslint/husky config, or the serving app's
  shared `Route` types. Keep `corpus-pipeline/` **outside `packages/`** so the
  `workspaces: ["packages/*"]` glob never adopts it. `STANDARDS.md` / `CLAUDE.md`
  govern the JS packages, not this Python pipeline.
- The `routes` table is the **sole integration seam** with the serving app
  (currently a stub with no DB connection, so the schema is greenfield). Its
  `Route` DTO (`{id,name,distance,waypoints[lat,lng][]}`) is a downstream
  projection the server owns — design the schema for the pipeline's needs, not
  the DTO's current toy shape; don't couple to it.
- Obey [`DECISIONS.md`](./DECISIONS.md) and the ADRs. Notably: projected CRS is
  **EPSG:32618 metres** (ADR-0002); coordinate order is `[lat,lon]` in YAML,
  `[lon,lat]` in code with a metro-bounds guard (Q5); per-endpoint ORS quota
  counters (Q4); no embedding/description columns, no pgvector (ADR-0004).
- **No data source outside** OSM (ODbL), US/NY government open data, and routes
  we generate on open data. Never Strava / Komoot / RideWithGPS. (AC#5)
- **No container config.** No `docker-compose.yml`, `Dockerfile`, or similar.
  The pipeline consumes `DATABASE_URL` and fails fast with a clear message if
  PostGIS is missing.
- Every external HTTP response is disk-cached at
  `data/raw/{client}/{sha256(request)}.json` and replayed on re-run; `--no-cache`
  busts it. Cache is the quota-survival + resumability mechanism.
- Idempotency: every phase re-runs safely; upsert on `(source, source_id)`,
  recompute derived columns.
- Append to [`BUILD-LOG.md`](./BUILD-LOG.md) as you work — commands run and what
  happened — not in one batch at the end.

---

## 3. Test inventory (spec-mandated — these MUST exist by WP5)

| Test | Built in |
|------|----------|
| Relation assembly: ordered / reversed / unordered / gapped fixtures | WP1 |
| RLE extras decoding (ORS surface/waytype/steepness) | WP4 |
| Dedup overlap math (duplicate + non-duplicate pairs) | WP1 (`geometry.py` helper) |
| Dedup precedence + hard-delete (canon beats osm on tie) | WP4 (DB behavior) |
| Facility-coverage normalization (route partly outside coverage) | WP3 |
| Integration: Phase 1 against a small cached Overpass fixture → `TEST_DATABASE_URL` (skip with a clear message if unset; never spin up a container) | WP1 / WP5 |

These are the *minimum*. Each WP also TDD-builds the behaviors listed in its
section. The behavior lists below **are** the user-approved test priorities — a
subagent does not need to round-trip for approval before writing them.

---

## 4. TDD protocol (every WP)

Vertical slices only (per the `tdd` skill):

```
RED  → write ONE test for the next behavior → it fails
GREEN→ write the MINIMAL code to pass it → it passes
        repeat for the next behavior
REFACTOR (only while GREEN) → dedupe, deepen modules, re-run tests
```

- One test at a time. Never write all tests then all code (horizontal slicing
  produces tests of imagined behavior).
- Test **observable behavior through public interfaces**, not internals. A test
  must survive an internal refactor.
- Never refactor while red.
- Use real code paths; mock only true externals (network, clock). Verify DB
  behavior through the pipeline's own interface, not by hand-querying internal
  state where avoidable. See the `tdd` skill's `mocking.md` for guidance.

---

## 5. Gate / Definition of Done (per WP)

A WP is **done** only when ALL hold — the orchestrator verifies each itself:

1. New behaviors are covered by TDD tests; `uv run pytest` is fully green.
2. The WP's **Neon verification** (its own row in the table below) passes against
   the live ephemeral PostGIS branch.
3. `BUILD-LOG.md` has the subagent's entries for this WP.
4. `git status` shows changes **only** under `corpus-pipeline/`.
5. The subagent returned the structured report (§7) with `gate: pass`.

---

## 6. Dependency graph & parallelism

```
WP0  (foundation + migration 001)        ← blocks everything
  │
  ▼
WP1  (Phase 1: OSM relations)            ← builds geometry.py (shared)
  │
  ├──────────────┐
  ▼              ▼
WP2 (Phase 2)   WP3 (Phase 3 scoring)    ← may run as PARALLEL subagents:
  │              │                          disjoint files, disjoint columns
  └──────┬───────┘
         ▼
WP4  (Phase 4: canon + generation)       ← needs WP3 scoring for its quality gate
         ▼
WP5  (final dedup+rescore, docs, README, full E2E + teardown)
```

- **WP0 is strictly first and alone** (everything imports its scaffold).
- **WP1 before WP2/WP3** because WP1 builds `geometry.py` (assembly, dedup,
  simplification helpers) that both reuse.
- **WP2 ∥ WP3** is the one safe parallelization: WP2 writes `clients/arcgis.py`,
  `clients/valhalla.py`, `matching.py`, Phase-2 ingest (writes `routes`); WP3
  writes `clients/socrata.py`, facility ingest (writes `facility_segments`) and
  the scoring pass (writes score columns). They touch disjoint files and disjoint
  columns. If run in parallel, **isolate them in separate git worktrees** to
  avoid working-tree collisions, then the orchestrator merges and runs a combined
  gate. If simpler, run them sequentially WP1→WP3→WP2; correctness is identical.
- The five API clients are independent and *could* each be a micro-subagent, but
  each is naturally owned by its phase WP. Only split them out if a phase WP is
  too large for one subagent.

---

## 7. Work packages

Each WP below is a ready-to-dispatch brief. The orchestrator pastes §2 (shared
invariants) + §4 (TDD protocol) + the WP body into the subagent prompt.

### Subagent report schema (every WP returns this)

```
wp: <id>
gate: pass | fail
tests_added: [<behavior names>]
neon_verification: <what was run + observed result>
files_changed: [<paths under corpus-pipeline/ only>]
decisions_touched: [<DECISIONS.md / ADR refs honoured or that need revisiting>]
surprises: [<anything the spec got wrong / live data differed>]
followups: [<deferred work, with why>]
```

---

### [x] WP0 — Foundation, config, cache, migration 001

**Goal:** a runnable skeleton that can `migrate` a plain PostGIS DB and `stats`
an empty corpus.

**Deliverables**
- `pyproject.toml` (uv, Python 3.12). Deps: `httpx`, `tenacity`, `shapely`,
  `pyproj`, `geojson`, `gpxpy`, `psycopg[binary]`, `pydantic`,
  `pydantic-settings`, `typer`, `PyYAML`. Dev: `pytest`.
- `src/freewheel_corpus/__init__.py`, `cli.py` (typer app with
  `migrate | phase1 | phase2 | phase3 | phase4 [--canon-only|--generate-only] |
  stats`; phase commands stubbed for now; **no `phase5`**).
- `config/settings.py` — pydantic-settings, all env-driven: `DATABASE_URL`,
  `ORS_API_KEY`, base URLs for each service (one env var each, defaulting to the
  public endpoint, because everything self-hosts later), scoring weights, gate
  thresholds.
- `cache.py` — disk cache keyed `data/raw/{client}/{sha256(request)}.json`;
  `--no-cache` bust.
- `db.py` — psycopg3 connection helper from `DATABASE_URL`; **PostGIS
  presence check that fails fast** with a clear message.
- `db/migrations/001_init.sql` — exactly the spec schema: `CREATE EXTENSION IF
  NOT EXISTS postgis`; `routes`, `facility_segments`, `ingest_log`; GIST indexes;
  `UNIQUE (source, source_id)`. **No pgvector, no description/embedding/
  embedding_model columns** (ADR-0004).
- migration runner (in `cli.py` / a `migrations.py`) tracking applied files in a
  `schema_migrations` table.
- `config/metro_boundary.geojson` — single hand-drawn polygon covering the five
  boroughs + Hudson/Bergen NJ (to Nyack via 9W), Westchester to ~Peekskill,
  Rockland, Nassau. **Coordinate order is `[lon, lat]` per RFC 7946 — the
  OPPOSITE of `canon.yaml`'s `[lat, lon]`.** Two conventions live in `config/`;
  document the boundary file's order in a top-level comment. Add a comment:
  *self-hosted ORS graph extract must later cover the bbox of ALL stored route
  geometry, not just this polygon.*
- `.gitignore` — `data/raw/`, large `data/manual/` payloads, `.env`,
  `__pycache__`, `.venv`.

**Behaviors to TDD (in order)**
1. Migration runner applies `001` to a fresh DB and records it in
   `schema_migrations` (tracer bullet).
2. Re-running `migrate` is idempotent (already-applied migration is skipped).
3. PostGIS-missing → clear, specific failure (not a raw psycopg error).
4. Cache stores a response and replays it for the same request hash.
5. `--no-cache` bypasses a cached entry.
6. Settings load from env; missing required var → clear error.

**Neon verification:** `migrate` against the Neon branch creates all three
tables + the GIST indexes + `postgis`; `schema_migrations` contains `001`;
second `migrate` is a no-op; `stats` runs clean on the empty corpus.

**Out of scope:** any phase logic; any client beyond the cache layer; pgvector.

---

### [x] WP1 — Phase 1: OSM bicycle route relations

**Goal:** OSM `route=bicycle` relations in `routes` with valid geometry,
`match_quality=1.0`, attribution. Satisfies **AC#1**.

**Deliverables**
- `clients/overpass.py` — POST to Overpass; throttle **1 req / 10 s**,
  single-threaded; disk-cached; base URL from settings.
- `geometry.py` — **shared module** (WP2/WP3/WP4 reuse it): relation assembly
  (`shapely.linemerge` + an ordering/reversal pass), gap handling (> 50 m → keep
  longest continuous component, log remainder), reject assembled length < 3 km,
  `is_loop` via start/end proximity < 200 m, length in km via EPSG:32618.
  **Also the pure dedup overlap predicate** (it's a geometry helper, so it lives
  here, not in a phase): given two LineStrings, project to EPSG:32618,
  `simplify`, and report whether `intersection(buffer(a, 25 m), b).length` exceeds
  80% of the shorter route — DB-free and unit-testable. The DB-side concerns
  (candidate pairing, precedence ladder, hard-delete) live where dedup is
  *invoked* (Phase 4 generation, and the final Phase-3 cross-source pass).
- `phases/p1_osm_relations.py` — build the Overpass query with the metro polygon
  as a simplified `poly:` filter. **Overpass `poly:` expects space-separated
  `"lat lon lat lon …"` — latitude FIRST, the opposite of the boundary file's
  GeoJSON `[lon, lat]`.** Convert in one helper and assert the result lands in
  metro bounds (lat 40–42, lon −75…−73) so a transposition fails loudly rather
  than silently querying the wrong region. Assemble each relation; extract tags
  (`name` →
  `ref` → `"Unnamed route {id}"`, plus `network`, `distance`, `ascent`,
  `descent`, `operator`); `osm_way_ids` from members; attribution
  `'© OpenStreetMap contributors, ODbL 1.0'`; upsert on `(source, source_id)`.
- Wire `cli.py phase1`.

**Behaviors to TDD (in order)**
1. Assemble **ordered** member ways → one continuous LineString (tracer bullet).
2. Assemble **reversed** ways → corrected orientation.
3. Assemble **unordered** ways → corrected order.
4. **Gapped** relation (> 50 m) → longest component kept + remainder logged.
5. Assembled length **< 3 km** → rejected (logged, not stored).
6. `is_loop` true when endpoints < 200 m apart, false otherwise.
7. Tag extraction with the `name → ref → Unnamed` fallback chain.
8. Upsert idempotency on `(source, source_id)` (second run updates, no dup row).
9. Overpass client caches and replays; throttle respected (inject a fake clock).
10. **Dedup overlap predicate** (mandated test): a duplicate pair (> 80% overlap)
    → true; a non-duplicate pair → false (projected, simplified, DB-free).

**Fixtures:** synthetic Overpass JSON for ordered/reversed/unordered/gapped/short
relations; one small **real cached** Overpass response (tiny bbox) for the
integration test.

**Neon verification:** `phase1` (served from the cached Overpass fixture) writes
`routes` rows with valid `geom`, `start_point`, `is_loop`, `distance_km`,
`match_quality=1.0`, `osm_way_ids`, attribution; `stats` shows the
`osm_relation` count. **This is AC#1.**

---

### [x] WP2 — Phase 2: loose GPX / polyline sources, map-matched

**Goal:** NYSDOT state routes (clipped to metro) and manual GPX, map-matched via
Valhalla, into `routes`.

**Deliverables**
- `clients/arcgis.py` — NYSDOT State Bike Routes FeatureServer/MapServer,
  `f=geojson`, paginate via `resultOffset`; verify the live endpoint under
  `gisportalny.dot.ny.gov` (NOT the dev portal); clip features to the metro
  polygon, skip non-intersecting.
- `clients/valhalla.py` — `/trace_attributes`, `costing=bicycle`,
  `shape_match=map_snap`; throttle **1 req/s**; header `X-Client-Id:
  freewheel-corpus`; base URL from settings; disk-cached.
- `matching.py` — resample input to a point every ~50 m; call Valhalla;
  `match_quality = matched_len / input_len`; if `< 0.85` keep route but set
  `geom = geom_original = raw` and log `failed_match`; pull `surface` and
  `use`/waytype from matched edges into the breakdown columns; **> 200 km →
  guard + log** (no chunk-and-stitch, see DECISIONS minor flags).
- `phases/p2_loose_gpx.py` — ingest NYSDOT (via arcgis) + all GPX in
  `data/manual/usbrs/` and `data/manual/open_gpx/` (parse with `gpxpy`); upsert.
- Wire `cli.py phase2`.

**Behaviors to TDD (in order)**
1. Resample a polyline to ~50 m spacing (tracer bullet).
2. `match_quality` = matched/input on a mocked Valhalla trace.
3. `< 0.85` → fallback: `geom = geom_original = raw`, `failed_match` logged.
4. Edge `surface` / `use` attributes → fractional breakdown by length.
5. `> 200 km` resampled input → guard fires + logs (no crash).
6. ArcGIS pagination assembles all pages; features clipped to metro polygon.
7. GPX directory ingest reads every `.gpx` present; idempotent upsert.

**Fixtures:** synthetic GPX; cached Valhalla `trace_attributes` response; cached
ArcGIS page JSON.

**Neon verification:** `phase2` writes `nysdot` + `usbrs` rows; breakdowns
populated; `failed_match` rows logged where match < 0.85; `geom_original`
semantics correct per source.

---

### [x] WP3 — Phase 3: facility data + quality scoring

**Goal:** `facility_segments` populated and every `routes` row carrying scores;
re-runnable.

**Deliverables**
- `clients/socrata.py` — NYC DOT Bicycle Routes as GeoJSON via the Socrata
  export endpoint, paginated; **discover the current dataset ID** at
  data.cityofnewyork.us; also fetch NYS `7bg2-3faq` JSON to **inspect & report**
  (Q6a — likely drop; never fabricate geometry).
- facility ingest + normalization: map the NYC DOT facility-type field into
  `{protected, lane, sharrow, greenway, other}` — **inspect the real field values
  first**, write the mapping explicitly in code with a comment, unknown → `other`
  + logged warning; **filter to currently-existing facilities (exclude retired)**
  before storing (Q7b); store as `MultiLineString` in `facility_segments`.
- `phases/p3_quality_scoring.py` — all projected math in **EPSG:32618**
  (ADR-0002):
  - `protected_lane_fraction` = fraction of route length within 15 m of a
    `protected` **or** `greenway` segment (`ST_Buffer` projected).
  - `greenway_fraction` = same, greenway only.
  - `facility_coverage_fraction` = fraction of route inside the facility-data
    coverage area (5-borough polygon for NYC DOT); compute facility fractions
    **only over the in-coverage portion** and normalize so out-of-coverage
    routes (e.g. the Rockland half of Nyack) aren't unfairly diluted.
  - `quality_score` = `0.4·protected + 0.2·greenway + 0.2·surface_quality +
    0.2·source_prior` (weights from config; source prior: canon/osm_relation
    1.0, nysdot/usbrs 0.9, generated 0.5). Document as a tunable v1 heuristic.
- Wire `cli.py phase3` (re-runnable; recompute in place).

**Behaviors to TDD (in order)**
1. NYC DOT facility-type normalization: known values → correct class; unknown →
   `other` + warning (tracer bullet).
2. Currently-existing filter excludes retired facilities.
3. `protected_lane_fraction` on a synthetic route + facility with known overlap →
   known fraction (projected buffer math).
4. **Facility-coverage normalization:** a route half outside coverage is scored
   only over its in-coverage half (the mandated test).
5. `quality_score` composite matches the weighted formula for known inputs.
6. Re-running `phase3` recomputes in place (idempotent), no duplicate rows.

**Fixtures:** synthetic route + facility geometries with hand-computed overlap; a
coverage fixture (route straddling the coverage boundary); cached Socrata page.

**Neon verification:** `phase3` populates `facility_segments`; every `routes` row
has `protected_lane_fraction`, `greenway_fraction`, `facility_coverage_fraction`,
`quality_score`; the coverage-normalized score behaves on a straddling route.

---

### [x] WP4 — Phase 4: canon seeding + scored generation

**Goal:** canon rides + variants and kept generated loops in `routes`, gated by
quality, deduped.

**Deliverables**
- `clients/ors.py` — `/v2/directions` (per-profile), round-trip directions
  (`options.round_trip {length, points, seed}`), `/elevation/line`; API key from
  settings; **per-endpoint daily request counters, persisted**; 40/min; on quota
  exhaustion exit **0** with a clear "resume tomorrow" message, resumable via
  cache (Q4); disk-cached.
- `config/canon.yaml` — **DRAFT ~40 rides** with a top banner `# DRAFT — every
  coordinate requires human verification before ingestion`; entries in human
  `[lat, lon]`; the required named rides (Central Park, Prospect Park, Manhattan
  perimeter, Hudson River Greenway, Brooklyn Waterfront, Coney Island via Shore
  Pkwy, Jamaica Bay + Rockaways, Floyd Bennett, Kissena/Cunningham, Flushing
  Meadows, City Island, Van Cortlandt + South County Trailway, Old Croton
  Aqueduct [mixed-surface], Bronx River Pathway, Roosevelt/Governors Island
  [ferry], Staten Island south shore, 9W to Piermont, 9W to Nyack, River Road NJ,
  State Line Lookout, Bear Mountain via 9W [long classic], Rockefeller carriage
  roads [gravel], Jones Beach via Wantagh/Bethpage) + judgment for the rest;
  length/direction variants encoded as `variants`.
- coordinate helper: `[lat,lon]` (YAML) → `[lon,lat]` (code) swap in one place +
  metro-bounds guard (Q5).
- `phases/p4_canon_and_generation.py`:
  - **Canon:** per entry + variant, ORS directions with start+waypoints
    (+ return leg for `out_and_back`), `extra_info:[surface,waytypes,steepness]`
    + elevation; parse GeoJSON; **decode RLE extras** → breakdowns; `source=canon`,
    `source_id=slug(:variant)`, `match_quality=1.0`; attribution `'© OpenStreetMap
    contributors, ODbL; routed via openrouteservice'`; persist `out_and_back` into
    `tags` (Q6b); ORS failure or distance > ±25% of `expected_km` → log + skip
    (not stored).
  - **Generation:** ~12 hardcoded seed start points (commented), target lengths
    15/25/40/60 km, seeds 0–4 → ~240 round-trip calls; compute Phase-3 score
    inline; **keep only** `quality_score ≥ 0.55` AND distance within ±20% of
    target AND not a duplicate; log rejects **with scores**.
- dedup **application** in the phase (the overlap predicate already exists in
  WP1's `geometry.py`): pair candidates, apply the precedence ladder
  `canon > osm_relation > nysdot > usbrs > generated`, hard-delete loser, log
  both IDs (ADR-0003). Used both for generated-candidate dedup here and by the
  final Phase-3 cross-source pass (WP5).
- Wire `cli.py phase4 [--canon-only|--generate-only]`.

**Behaviors to TDD (in order)**
1. **RLE extras decode**: ORS run-length `[from,to,value]` triples → per-length
   fractional breakdown (mandated test; tracer bullet).
2. Coordinate `[lat,lon]→[lon,lat]` swap + bounds guard rejects an out-of-metro
   coord.
3. Canon distance sanity: route > ±25% of `expected_km` → skipped + logged.
4. Dedup **precedence + hard-delete** (DB behavior; overlap predicate itself is
   tested in WP1): given an overlapping pair, canon beats osm_relation on a tie,
   the loser is hard-deleted, both IDs logged `skipped_duplicate`.
5. ORS per-endpoint quota counter increments; near-quota → graceful exit 0 +
   resumable.
6. Generation quality gate keeps ≥ 0.55 within ±20% length, rejects others with
   logged scores.

**Fixtures:** cached ORS directions response with RLE extras; cached round-trip
response; dedup geometry pairs (duplicate + non-duplicate); a too-long/too-short
canon response.

**Neon verification:** `phase4 --canon-only` writes canon rows (bad coords
expected on first pass → review `ingest_log` → fix → re-run); `phase4
--generate-only` writes only kept generated loops with rejects logged; quota
counter persists across runs.

---

### [x] WP5 — Final pass, docs, README, full E2E + teardown

**Goal:** the corpus assembled per the canonical run order, the two reference
docs, the README, and a verified end-to-end satisfying all acceptance criteria.

**Deliverables**
- Run-order wiring so the documented sequence works:
  `migrate → phase1 → phase2 → phase3 → phase4 → phase3` (the final phase3 scores
  generated/canon rows **and** runs the full-table cross-source dedup pass,
  ADR-0003).
- `stats` complete: counts by source, score distribution, unmatched/rejected
  counts.
- `docs/infrastructure.md` — DB handoff spec (Postgres 16; PostGIS 3.4+ now;
  pgvector later → link embeddings-plan; `DATABASE_URL` contract + DDL rights;
  trivial data volume; one **REFERENCE-ONLY** `postgis/postgis:16` compose
  snippet noting pgvector as a future add; note future self-hosted ORS/Valhalla
  graph extent). Explicitly *not implemented here*.
- `docs/embeddings-plan.md` — Phase-5 warm-start, top banner "NOTHING in this
  document is implemented…"; description template (exclude hard constraints,
  coords, names; terrain/surface/protection in words), `Embedder` protocol
  (hosted 1536-dim + local 384-dim, dim is config-time, every row stores
  `embedding_model`, mixed-model corpora forbidden), the future `ALTER TABLE`
  (`CREATE EXTENSION vector; ADD description/embedding(<dim>)/embedding_model`),
  no ANN index at this scale, and the ranking acceptance test.
- `README.md` — setup, env vars, run order, the canon-verification workflow,
  the `osm-api-js` "considered alternatives" verdict, ODbL attribution
  obligations (must surface in any UI; share-alike implications for the derived
  DB), pointers to the two docs above.
- Integration test (Phase 1 vs cached Overpass → `TEST_DATABASE_URL`, skip
  cleanly if unset).

**Behaviors to TDD (in order)**
1. Full-table cross-source dedup pass removes a canon↔osm duplicate per the
   precedence ladder (extends WP4 dedup tests to the orchestrated pass).
2. `stats` reports counts-by-source, score distribution, rejected/unmatched.
3. Integration test runs Phase 1 into `TEST_DATABASE_URL` and skips clearly when
   unset.

**Neon verification — split into two gates (this is critical; see §11):**

*Gate 5a — pipeline correctness (autonomously verifiable; this is the WP5 gate
the orchestrator enforces):*
- AC#1: `migrate && phase1` → OSM routes with valid geometry + breakdowns.
- AC#2 (mechanism): each phase runs on public APIs, respects per-endpoint quotas,
  and resumes from cache after an induced interruption. A quota exit-0 is a
  **pause, not a failure** (§11).
- AC#3 (shape): every ingested row carries scores; `stats` runs and reports
  counts-by-source / score distribution / rejected-unmatched; **no
  description/embedding columns exist** (inspect `information_schema`).
- AC#4: both reference docs exist, accurate, marked not-implemented.
- AC#5: no Strava/Komoot/RideWithGPS code path; `git diff --name-only main`
  touches only `corpus-pipeline/`.

*Gate 5b — corpus completeness (NOT autonomously achievable; do not block on it):*
- AC#3 (volume/coverage): "~100–150 routes spanning all five sources" depends on
  **human-gated inputs** — canon `[lat,lon]` are DRAFT and need human
  verification (first run will log many `>±25%` distance skips, which are
  expected), and `usbrs` requires **manually-downloaded GPX** absent in an
  unattended build (so the `usbrs` source may be empty). The orchestrator records
  the achieved count and the canon-skip / empty-USBRS state, and **escalates to
  the human** for the verify-coords → re-run loop rather than retrying.

Then the orchestrator tears down the Neon branch (§9).

---

## 8. Commits

One commit per green WP gate, on `feat/corpus-pipeline`:
`wp0: foundation + migration 001`, `wp1: phase 1 osm relations`, … `wp5: final
pass, docs, e2e`. Commit message body: behaviors covered + gate result. (Push /
PR only when the human asks.)

## 9. Neon lifecycle (orchestrator-owned)

1. Before WP0 gate: create a Neon project/branch, enable `postgis`, set
   `DATABASE_URL`. If `postgis` can't be enabled, fall back to a local
   Homebrew Postgres+PostGIS and note it in BUILD-LOG.
2. Reuse the same branch across WP1–WP5 so state accumulates like a real run.
3. Keep `TEST_DATABASE_URL` pointed at the same branch (or a child branch) for
   the integration test.
4. After WP5 gate: tear the branch down; record teardown in BUILD-LOG.

## 10. Resumability note

Because every external call is disk-cached (§2), a quota-exhausted or
interrupted run resumes nearly free. A subagent that hits the ORS daily quota
exits 0 with "resume tomorrow"; the orchestrator treats that as a *pause*, not a
gate failure, logs it, and re-dispatches on the next run.

## 11. Expected pauses, human gates & external prerequisites

These are **not** code failures and must **not** enter the retry-3× loop (§1.3).
The orchestrator logs each, and where noted, escalates to the human instead of
retrying.

| Condition | Why expected | Orchestrator action |
|-----------|--------------|---------------------|
| ORS daily quota reached (exit 0) | Free tier ~2,000/day; ~300 directions + generation in one day is fine, but reruns/elevation can tip it | Treat as pause; re-dispatch next run (cache makes it cheap) |
| Canon entries skipped for distance > ±25% | `canon.yaml` coords are **DRAFT**; first-run bad waypoints are expected | Log skips; **escalate to human** for verify-coords → re-run. Never "fix" coordinates autonomously |
| `usbrs` source empty | USBRS GPX is **manually downloaded** into `data/manual/usbrs/`; absent in an unattended build | Log empty source; do not fail Gate 5a; counts toward Gate 5b only |
| `TEST_DATABASE_URL` unset | Integration test is opt-in | Skip test with a clear message |

**External prerequisites (confirm before the WPs that need them):**
- **`ORS_API_KEY`** — required for WP4 *live* fixture capture and the WP4/WP5
  Neon verification (canon + generation). Unit tests use synthetic fixtures and
  need no key. **If the key is absent, a subagent records "fixtures pending
  creds" and the orchestrator treats WP4 live-verification as deferred, not a
  code failure** — it does not retry. Confirm the key exists (or get it from the
  human) before dispatching WP4's live steps.
- **Manual GPX** in `data/manual/usbrs/` and `data/manual/open_gpx/` — supplied
  by the human; the pipeline ingests whatever is present, including nothing.
- **Neon/PostGIS** — orchestrator-provisioned (§9); the only hard prerequisite
  for every gate.

---

## Progress (orchestrator ticks these)

- [x] WP0 — Foundation, config, cache, migration 001
- [x] WP1 — Phase 1: OSM relations
- [x] WP2 — Phase 2: loose GPX
- [x] WP3 — Phase 3: facility scoring
- [x] WP4 — Phase 4: canon + generation
- [x] WP5 — Final pass, docs, README, E2E + teardown
