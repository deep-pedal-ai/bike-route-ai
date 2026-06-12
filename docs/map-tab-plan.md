# Build Plan — Corpus Map Tab

**Audience:** an *orchestrator agent* that dispatches each work package below to a
*subagent* (Opus is fine for subagents) and enforces the gate between them.
**Method:** test-driven development, **vertical slices** (per the `tdd` skill).
**Decisions this plan implements:** the six resolved design decisions in §0. Read
them first; do not relitigate them.
**Goal in one line:** add a polished, interactive **Map** tab to the React client
that loads the route corpus live from Neon (PostGIS) and renders it on a MapLibre
map — so the corpus stops being a black box. The serving app has *never* been
wired to Neon; this plan builds that seam read-only, then draws it.

---

## 0. Resolved decisions (do not relitigate)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Ambition | **Tier 2** — polished product surface, not a throwaway debugger |
| D2 | Data scope | **Routes (core) + facility overlay** — overlay toggled OFF by default, viewport (bbox) loaded |
| D3 | Map library | **MapLibre GL JS** via `react-map-gl/maplibre` (23.8k facility features ⇒ WebGL; Leaflet ruled out) |
| D4 | Basemap | **Carto dark-matter** `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` — free, no token, ✅ verified 200. Fallback `positron-gl-style` |
| D5 | Navigation | **react-router**, URL-addressable: `/` = Generate (existing), `/map` = Explore, `/map?route=:id` deep-link |
| D6 | Inspector UX | **Map-first + slide-in detail panel**; compact filter bar; color routes by `source` with a toggle to a `quality_score` gradient |

**Derived, non-negotiable:** route fields in the detail panel carry **plain-English
help text sourced from the `001_init.sql` column comments** (this is the
"*understand* my data" half of the ask — meaning-legibility is function, not polish).

---

## 1. Orchestration model

```
        ┌─────────────────────────────────────────────┐
        │  ORCHESTRATOR (owns sequence, gates, branch   │
        │  hygiene, Neon test-branch lifecycle, commits)│
        └───────────────┬───────────────────────────────┘
                        │ dispatches WPs per the DAG (§6); fans out within a phase
                        ▼
        ┌─────────────────────────────────────────────┐
        │  SUBAGENT — executes ONE work package with    │
        │  strict TDD, returns a structured report (§7) │
        └─────────────────────────────────────────────┘
```

**Orchestrator responsibilities**
1. Dispatch WPs in dependency order (§6). Never start a WP whose gate-predecessors
   haven't passed. **Within a phase, dispatch the parallel group concurrently.**
2. After each subagent returns, **independently verify the gate** (§5) — run the
   tests / lint / typecheck itself; do not trust the report alone.
3. On gate failure, dispatch a *fix* subagent with the exact failure output; retry
   up to 3× before escalating to the human.
4. Commit on `feat/map-tab` after each green gate (one commit per WP).
5. Tick the WP checkbox here and append an entry to `docs/map-tab-build-log.md`.
6. Own the **Neon test-branch** lifecycle (§9) for integration tests. **Never
   write to the corpus** — the app is read-only; integration tests only SELECT.
7. **Enforce worktree isolation for concurrent same-package WPs** (§6) and merge.

The orchestrator **does not write feature code** — only commits, checkboxes, and
build-log entries.

---

## 2. Shared invariants (inject §2 + §4 into every subagent brief)

- **Conform to [`STANDARDS.md`](../STANDARDS.md) and [`CLAUDE.md`](../CLAUDE.md).** Non-exhaustive, load-bearing here:
  - TS `strict`; **`any` is banned** (use `unknown` + narrow). `type` over `interface` for object shapes.
  - **Express layered architecture, strict:** `routes/` (URL→controller only) → `controllers/` (req/res) → `services/` (business logic, **must NOT import from `express`**) → `clients/` (external API + **DB queries**). Cross-cutting in `middleware/`.
  - Error responses are `{ error: string, statusCode: number }`; async handlers `try/catch → next(err)`; errors centralised in `middleware/error-handler.ts`.
  - React: **function components only, one per file, PascalCase filename**; hooks rules enforced; **`useState` only** (no Redux/Zustand/Jotai); `useEffect` callbacks can't be `async` — wrap an inner async fn.
  - **ESM:** import paths in source use `.js` extensions. Import order: external → internal → `import type`.
  - Files kebab-case except React components (PascalCase). Tests co-located, `*.test.ts(x)`.
- **The DB seam is READ-ONLY.** The app SELECTs from `routes` / `facility_segments`; it NEVER writes. (`001_init.sql`: *routes is "the sole integration seam … a downstream projection."*) Prefer a read-only Postgres role in `DATABASE_URL`.
- **Geometry is `EPSG:4326` (WGS84) already** — no reprojection. `ST_AsGeoJSON` emits **`[lng, lat]`**; feed GeoJSON **natively** into MapLibre `Source`/`Layer`. **Never hand-flip coordinates.** A regression test asserts the first coordinate falls in the NY bbox (`lng ∈ [-75.1,-72.7]`, `lat ∈ [40.2,44.2]`).
- **Build every endpoint's entire response body in SQL as `json`/`jsonb` (all four, `/stats` included) and `JSON`-parse it.** `node-postgres` returns `bigint`/`numeric`/`count(*)` as JS **strings** (you saw `"149"` quoted in the row-count query), which violates the `number` contract. Assembling the response with `json_build_object` / `jsonb_agg` / `ST_AsGeoJSON(...)::json` keeps numerics as JSON numbers and geometry parsed. **Never hand-map `pg` rows into the response in JS** (that re-introduces the string-numeric bug). Note the trap: the §3 fixture is SQL-built and therefore *correct*, so a JS-mapped `/stats` would pass client tests yet break live — guard it with an explicit type assertion in S3b's test (`typeof body.routes_by_source.canon === 'number'`).
- **Do not break the existing AI-gen flow.** The `/` Generate page, `data/mock-routes.ts`, and the existing `shared` `Route`/`RouteRequest`/`RouteResponse` types stay. **Extend** `shared` with new *corpus* types; do not modify the existing ones (they are a different model).
- **Touch only `packages/**`.** Never modify `corpus-pipeline/` (a separate local-only project) or its pipeline. The map tab only reads what the pipeline produced.
- **Per-package CI gates must stay green:** `npm run lint`, `npm run typecheck`, and **vitest coverage ≥ 70%** (lines/functions/branches/statements — enforced in `ci.yml`). See §5 for where the coverage gate is checked.
- **CI must be able to earn server coverage (P0 wires this, else S3b's gate fails confusingly).** `corpus-client.ts`'s behavior *is* the DB interaction, so its coverage comes from S1's **integration** tests. But those skip when `TEST_DATABASE_URL` is unset, and `ci.yml` currently sets none — so in CI the SQL client would report 0% and drag `packages/server` below 70%. **P0 must:** (a) add a CI secret/env `TEST_DATABASE_URL` pointing at the Neon **test branch** so the real-code-path tests run in CI, and (b) exclude pure connection plumbing `src/db.ts` from the server vitest `coverage.include`. Do **not** "fix" coverage by mocking `pg` — that yields the brittle, implementation-coupled tests `tdd/mocking.md` warns against; it is a last resort, not the default.
- **Carto attribution** is required on the map (free tier).
- Append to `docs/map-tab-build-log.md` as you go — commands + what happened — not in one batch at the end.

---

## 3. The contract — the seam that makes TDD parallel (frozen in P0)

The single reason this plan parallelizes without horizontal-slicing: P0 freezes a
**shared contract** and a **real fixture**, then every downstream WP TDDs its own
vertical slice against that stable interface. The contract is *interface
definition*, not bulk test-writing.

**Shared types** (`packages/shared/src/corpus.ts`, re-exported from `index.ts`):
```ts
// GeoJSON-native. Use @types/geojson for Feature/FeatureCollection generics.
export type CorpusRouteProps = {
  id: number; name: string | null; source: string;
  distance_km: number | null; is_loop: boolean | null;
  quality_score: number | null; ascent_m: number | null; descent_m: number | null;
  network: string | null;
};
export type CorpusRouteDetailProps = CorpusRouteProps & {
  source_id: string; match_quality: number | null;
  surface_breakdown: Record<string, number> | null;
  waytype_breakdown: Record<string, number> | null;
  steepness_breakdown: Record<string, number> | null;
  protected_lane_fraction: number | null; greenway_fraction: number | null;
  facility_coverage_fraction: number | null;
  attribution: string | null; osm_way_id_count: number; tags: Record<string, unknown>;
};
export type FacilityProps = { id: number; facility_class: string; borough: string | null };
// Endpoint payloads are FeatureCollection<LineString, …> / FeatureCollection<MultiLineString, FacilityProps>.
export type FacilitiesResponseMeta = { truncated: boolean; count: number };
```

**API contract** (server implements, client consumes):
| Method | Path | Returns |
|---|---|---|
| GET | `/api/corpus/routes` | `FeatureCollection<LineString, CorpusRouteProps>` — all 149, `ST_Simplify(geom,0.0001)` (~175 kB) |
| GET | `/api/corpus/routes/:id` | `Feature<LineString, CorpusRouteDetailProps>` — full-res geom + all fields, `404 {error,statusCode}` if absent |
| GET | `/api/corpus/facilities?bbox=minLng,minLat,maxLng,maxLat&classes=a,b` | `FeatureCollection<MultiLineString, FacilityProps>` + `truncated`/`count` meta; bbox required, classes optional |
| GET | `/api/corpus/stats` | `{ routes_by_source: Record<string,number>, facilities_by_class: Record<string,number>, bbox: [minLng,minLat,maxLng,maxLat] }` |

**Field-description map** (`packages/client/src/corpus-field-docs.ts` — **in
`client`, not `shared`:** `shared` is types-only per CLAUDE.md, and this is a
UI-only concern consumed by the panel): a `Record<keyof CorpusRouteDetailProps,
string>` of plain-English descriptions **copied from the `001_init.sql` column
comments** (e.g. `match_quality` → "1.0 for native sources; matched_len/input_len
for map-matched"). Drives panel tooltips. The `shared` side keeps only the *type*.

**Fixture** (`packages/client/src/fixtures/corpus-sample.json` — also in `client`,
since it's runtime data, not a type): a **real** small `FeatureCollection`
(≈6 routes incl. one loop, multiple sources) + a facility sample, pulled from Neon
in P0. Client WPs test against this — they do **not** need the server running.
(`shared` stays pure: corpus *types* only.)

> Once P0 lands, the contract is **frozen**. A WP that discovers it needs a
> contract change must stop and signal the orchestrator (which re-freezes and
> notifies dependents) — it must not fork the interface silently.

---

## 4. TDD protocol (every WP) — and the parallelism rule

Vertical slices only:
```
RED   → write ONE test for the next behavior → it fails
GREEN → write the MINIMAL code to pass it → it passes   (repeat per behavior)
REFACTOR (only while GREEN) → dedupe, deepen modules, re-run tests
```
- One test at a time. **Never** write all tests then all code (horizontal slicing → tests of imagined behavior).
- Test **observable behavior through public interfaces**, not internals; a test must survive an internal refactor.
- Mock only true externals (network/`fetch`, clock, the DB pool for unit tests). Integration WPs use the real Neon **test branch**.
- **Parallelism rule (resolves the TDD-vs-speed tension):** parallelism is at the **module boundary**, never within a vertical slice. Each subagent owns one module and runs its *own complete* red→green→refactor against the frozen contract (§3). The orchestrator never splits "tests" and "implementation" of the same module across agents.
- **MapLibre is not unit-testable in jsdom (WebGL).** Keep `MapExplorer` thin; push all logic (color/filter expressions, fitBounds, URL sync, data shaping) into **pure modules that ARE tested**. The canvas wrapper's correctness is verified in Phase 3 (Playwright), not by unit tests. This keeps package coverage ≥ 70% despite the untestable shell.

---

## 5. Gate / Definition of Done

**Per micro-WP** (orchestrator verifies each itself):
1. New behaviors covered by TDD tests; the package's `vitest run` is green.
2. `npm run lint` and `npm run typecheck` clean for the touched package(s); no `any`.
3. `git diff --name-only` touches only the files in the WP's scope (and only `packages/**`).
4. Subagent returned the §7 report with `gate: pass`.

**Per package-join** (S-join and C-join, and final): additionally
5. **`npm run coverage -w packages/<pkg>` meets the 70% threshold** (coverage is a
   whole-package metric — it is satisfied by the *sum* of the package's WPs, so it
   is gated at the join, not per micro-WP).
6. Integration/E2E verification for that package passes (§ per-WP rows).

---

## 6. Dependency graph & parallelism

```
P0  Foundation + FROZEN contract + fixture            ← strictly first, alone, blocks everything
     │
     ├──────────────── TRACK S (packages/server) ─────────────┐   ┌──────────── TRACK C (packages/client) ────────────┐
     ▼                                                          ▼   ▼                                                    ▼
  ┌────────── parallel group S* ──────────┐               ┌──────────────────── parallel group C* ────────────────────┐
  │ S1 corpus-client (DB / test branch)   │               │ C1 router-shell   C2 data-hooks   C3 encoding-utils        │
  │ S2 corpus-service + geojson (pure)    │               │ C4 RouteDetailPanel   C5 FilterBar   C6 Legend             │
  │ S3a error-handler middleware (indep.) │               └────────────────────────────────────────────────────────────┘
  └───────────────────────────────────────┘                              │ (all six against contract+fixture)
                     │                                                     ▼
                     ▼                                            C7 MapExplorer (CLIENT JOIN — assembles C1–C6)
            S3b controller+routes (SERVER JOIN — supertest)                │
                     └───────────────────────────┬───────────────────────┘
                                                 ▼
                                   PHASE 3  E2E verification (serial, holistic — live Neon + Playwright)
                                                 ▼
                                   PHASE 4  frontend-design polish (P1 type/palette → P2 motion/states → P3 a11y/attrib)
```

**Parallel groups & isolation**
- **P0 is strictly first and alone** — everyone imports the contract + deps.
- **Track S ∥ Track C** — disjoint packages (`server` vs `client`); no collision.
- **Within S:** `S1`, `S2`, `S3a` are disjoint files → run concurrently. `S3b` joins them.
- **Within C:** `C1–C6` are disjoint files, all built against contract+fixture → run concurrently (up to 6 subagents). `C7` joins them.
- **Worktree isolation:** concurrent subagents writing the *same package* must run in **separate git worktrees** (per the corpus-pipeline plan's pattern); the orchestrator merges and runs the package-join gate. Cross-package (S vs C) needs no isolation.
- **Critical path:** `P0 → max(C1..C6) → C7 → Phase 3 → Phase 4`. The server track (`P0 → max(S1,S2) → S3b`) finishes earlier and waits at Phase 3. This is why P0 must be small and fast.

---

## 7. Work packages

The orchestrator pastes §2 (invariants) + §3 (contract) + §4 (TDD protocol) + the
WP body into the subagent prompt.

### Subagent report schema (every WP returns this)
```
wp: <id>
gate: pass | fail
tests_added: [<behavior names>]
verification: <tests/lint/typecheck output summary + any Neon test-branch result>
files_changed: [<paths under packages/** only>]
contract_pressure: [<any place the §3 contract felt wrong — DO NOT change it; report it>]
surprises: [<live data or API differed from the brief>]
followups: [<deferred work, with why>]
```

---

### [x] P0 — Foundation, dependencies, frozen contract + fixture  *(serial, blocks all)*

**Goal:** branch, deps, env, and a frozen `shared` contract + real fixture so S and
C tracks can build in parallel without the server.

**Deliverables**
- Branch `feat/map-tab` off `main`.
- Deps: server `pg` + `@types/pg`; client `react-router-dom`, `react-map-gl`, `maplibre-gl`. (`@types/geojson` where needed.) `npm install`; commit lockfile.
- `packages/server/.env.example` gains `DATABASE_URL=` (+ optional `TEST_DATABASE_URL=`); real `DATABASE_URL` (read-only role, Neon project `sweet-wildflower-00839123`, branch `main`) into `packages/server/.env` — supplied by orchestrator/human, not committed.
- `packages/shared/src/corpus.ts` — **corpus *types* only** (§3), re-exported from `index.ts`. **No runtime code in `shared`** (CLAUDE.md).
- `packages/client/src/corpus-field-docs.ts` — the `Record<…,string>` docs map (from `001_init.sql` comments). Runtime const ⇒ lives in `client`, not `shared`.
- `packages/client/src/fixtures/corpus-sample.json` — pulled from Neon: `SELECT jsonb_build_object('type','FeatureCollection','features', …)` over ~6 routes (mixed sources, ≥1 loop) using `ST_AsGeoJSON(ST_Simplify(geom,0.0001))`, plus a handful of facilities. Committed.
- **CI coverage wiring** (§2): add `TEST_DATABASE_URL` (Neon test branch) to the CI environment and exclude `src/db.ts` from `packages/server`'s vitest `coverage.include`.
- **Freeze + announce the contract.** Any later change requires orchestrator re-freeze.

**Behaviors to TDD (light — this WP is mostly scaffolding):**
1. `corpus-field-docs` (client) has a non-empty description for **every** `CorpusRouteDetailProps` key (guards the "explain the fields" requirement; a `keyof` exhaustiveness check also fails typecheck if a field is missing).
2. The fixture parses as a valid `FeatureCollection` and its first route's first coordinate is in the NY bbox (locks coordinate-order expectation into the fixture itself).

**Gate:** typecheck + lint clean; both tests green; deps install; contract frozen.
**Out of scope:** any endpoint logic, any UI.

---

### [x] S1 — Server: `clients/corpus-client.ts` (the Neon read seam)  *(parallel in S*)*

**Goal:** a deep DB-query module owning all corpus SQL, returning plain data
(GeoJSON geometry already parsed), tested against the Neon **test branch**.

**Deliverables**
- `packages/server/src/db.ts` — a single pooled `pg.Pool` from `DATABASE_URL` (Neon SSL). Lazy/singleton.
- `packages/server/src/clients/corpus-client.ts`:
  - `getRoutesOverview(): Promise<Feature<LineString,CorpusRouteProps>[]>` — `ST_AsGeoJSON(ST_Simplify(geom,0.0001))`, overview props.
  - `getRouteById(id): Promise<Feature<LineString,CorpusRouteDetailProps> | null>` — full-res geom + all detail fields (incl. `array_length(osm_way_ids,1)` → `osm_way_id_count`).
  - `getFacilitiesInBbox(bbox, classes?): Promise<{features; truncated; count}>` — `geom && ST_MakeEnvelope(...,4326)` (uses GiST index), optional `facility_class = ANY($classes)`, `ST_Simplify`, `LIMIT N+1` to detect truncation.
  - `getStats()` — counts by source / facility_class + `ST_Extent`, **assembled as a single `jsonb` object in SQL** so the counts come back as JSON numbers, not `pg` strings.
- Build **every** response body **in SQL** (`json_build_object` / `jsonb_agg` / `ST_AsGeoJSON(...)::json`) and `JSON`-parse it; never string-concat geometry and never hand-map `pg` rows in JS (§2 — avoids the `bigint`/`numeric`-as-string trap).

**Behaviors to TDD (integration, against `TEST_DATABASE_URL`; skip-with-message if unset):**
1. `getRoutesOverview` returns a non-empty array of `Feature`s; each geometry is a `LineString`; **first coord in NY bbox** (tracer bullet + coordinate-order regression).
2. Overview features carry exactly the `CorpusRouteProps` keys.
3. `getRouteById(known_id)` returns full detail incl. `surface_breakdown` as an object; `getRouteById(-1)` → `null`.
4. `getFacilitiesInBbox` with a tiny bbox returns fewer features than a metro-wide bbox (bbox filter works); `classes=['protected']` returns only that class.
5. Truncation flag: a `LIMIT` smaller than the bbox population sets `truncated:true`.

> Assert **invariants** (shape, class filter, bbox monotonicity, coordinate order), not exact row counts — data is live and grows.

**Verification:** integration tests green against the test branch; no writes issued (read-only role proves it).
**Out of scope:** HTTP layer, response assembly policy (that's S2/S3).

---

### [x] S2 — Server: `services/corpus-service.ts` + `services/geojson.ts` (pure)  *(parallel in S*)*

**Goal:** business logic with **zero express imports** — param parsing/validation
and FeatureCollection assembly — unit-tested against a **mocked** client interface.

**Deliverables**
- `services/geojson.ts` — `toFeatureCollection(features)`, and the facilities response wrapper (`{type:'FeatureCollection',features, …meta}`).
- `services/corpus-service.ts` — depends on the **client interface** (injected/imported): `listRoutes()`, `getRoute(id)`, `listFacilities(rawBbox, rawClasses)`, `stats()`. Owns: `parseBbox(str)` (4 finite numbers, min<max, else a validation error → `{error,statusCode:400}`), `parseClasses(str)` (whitelist against the 5 known classes), and mapping a missing route to a 404-shaped error.

**Behaviors to TDD (unit; mock the client):**
1. `parseBbox("−74,40,−73,41")` → tuple; `parseBbox("garbage")` / wrong arity / min≥max → validation error (tracer bullet).
2. `parseClasses("protected,greenway")` → filtered known classes; unknown values dropped; empty → undefined (all).
3. `listRoutes()` wraps client rows into a valid `FeatureCollection`.
4. `getRoute(missing)` surfaces a 404-shaped error; `getRoute(present)` returns the Feature.
5. `listFacilities` forwards parsed bbox+classes to the client and passes through the `truncated`/`count` meta.

**Verification:** unit tests green; `grep` proves no `express` import in `services/`.
**Out of scope:** req/res, routing.

---

### [x] S3a — Server: `middleware/error-handler.ts`  *(parallel in S*, independent)*

**Goal:** the central error handler producing the standard error shape.

**Deliverables:** `middleware/error-handler.ts` — `(err, req, res, next)` → `res.status(err.statusCode ?? 500).json({ error: err.message ?? 'Internal Server Error', statusCode: err.statusCode ?? 500 })`; a small typed `HttpError`.

**Behaviors to TDD:** known `HttpError(400,…)` → 400 + correct shape (tracer); unknown error → 500 + generic message + shape.
**Verification:** unit tests green. **Out of scope:** wiring (S3b mounts it).

---

### [ ] S3b — Server JOIN: controllers + routes + mount  *(server join; needs S1,S2,S3a)*

**Goal:** the live `/api/corpus/*` endpoints, end-to-end via supertest.

**Deliverables**
- `controllers/corpus-controller.ts` — thin: extract params from `req`, call the service, `res.json(...)`, `try/catch → next(err)`.
- `routes/corpus.ts` — `Router` mapping the 4 paths to controller fns (no logic).
- `app.ts` — mount `app.use('/api/corpus', corpusRouter)` and `app.use(errorHandler)` last. (Leave existing `/api/routes` untouched.)

**Behaviors to TDD (supertest against `app`; integration hits test branch):**
1. `GET /api/corpus/routes` → 200, body is a `FeatureCollection`, `features.length > 0`, first coord in NY bbox (tracer + regression).
2. `GET /api/corpus/routes/:id` (known) → 200 Feature with detail fields; unknown → 404 `{error,statusCode}`.
3. `GET /api/corpus/facilities` without `bbox` → 400; with bbox → 200 FeatureCollection + meta.
4. `GET /api/corpus/stats` → 200 with `routes_by_source` etc.

**Gate (server package-join):** all server tests green **+ coverage ≥ 70% for `packages/server`** + lint + typecheck.
**Out of scope:** any client code.

---

### [x] C1 — Client: router shell + nav  *(parallel in C*)*

**Goal:** introduce react-router and two tabs without breaking the Generate flow.

**Deliverables**
- `main.tsx` wraps `<BrowserRouter>`. `App.tsx` becomes a layout with `<Header/>` + `<Routes>`: `/` → `GeneratePage`, `/map` → `MapExplorer`.
- Move the current hero/search/results JSX out of `App.tsx` into `pages/GeneratePage.tsx` **unchanged in behavior**.
- `Header.tsx` gains nav links (`Generate` / `Map`) with active styling; keep brand + existing button.
- `pages/MapExplorer.tsx` — placeholder for now (C7 fills it).

**Behaviors to TDD (testing-library + router memory):**
1. At `/`, the Generate hero + search render (existing flow intact — tracer).
2. At `/map`, the MapExplorer placeholder renders, not the hero.
3. Header nav link to `/map` switches the view; active link reflects location.

**Verification:** tests green; existing `App.test.tsx`/`Header.test.tsx` updated to match, still green.
**Out of scope:** map, data.

---

### [x] C2 — Client: data hooks  *(parallel in C*)*

**Goal:** `useCorpusRoutes()`, `useCorpusRoute(id)`, `useFacilities(bbox,classes,enabled)` — fetch + loading/error/data state, per the STANDARDS async pattern.

**Deliverables:** `hooks/use-corpus-routes.ts`, `hooks/use-corpus-route.ts`, `hooks/use-facilities.ts`. Each returns `{ data, loading, error }`; `useEffect` inner-async; abort on unmount/dep-change; `useFacilities` is a no-op until `enabled` and refetches on bbox change (debounced).

**Behaviors to TDD (mock global `fetch`; assert against the §3 fixture):**
1. `useCorpusRoutes` → loading then the fixture FeatureCollection (tracer).
2. fetch rejects/non-200 → `error` set, `loading` false.
3. `useCorpusRoute(id)` requests `/api/corpus/routes/:id`.
4. `useFacilities(..., enabled=false)` issues no request; flipping `enabled` true issues one; changing bbox refetches (debounce verified with a fake clock).

**Verification:** tests green; no `async` `useEffect` callback (lint/STANDARDS).
**Out of scope:** rendering.

---

### [x] C3 — Client: encoding + map-helper utils (pure)  *(parallel in C*)*

**Goal:** all pure map logic, fully unit-tested, so `MapExplorer` stays thin.

**Deliverables:** `utils/route-color.ts` (`colorBySource(source)` categorical, harmonised with lime; `colorByQuality(score)` gradient), `utils/maplibre-filter.ts` (filter state → MapLibre `filter` expression), `utils/bounds.ts` (`fitBoundsFromFeatures(fc)` → `[[w,s],[e,n]]`), `utils/facility-color.ts` (class → color).

**Behaviors to TDD:**
1. `colorBySource` returns distinct stable colors for the 4 sources; unknown → a default (tracer).
2. `colorByQuality(1)` ≠ `colorByQuality(0)`; null → neutral.
3. `buildFilter({sources, minKm, maxKm, loopOnly, minQuality})` → an expression that includes/excludes known feature props correctly (test the expression's effect on sample props).
4. `fitBoundsFromFeatures` returns the correct bbox for a known FeatureCollection (NY extent).

**Verification:** unit tests green. **Out of scope:** React.

---

### [x] C4 — Client: `RouteDetailPanel` (presentational)  *(parallel in C*)*

**Goal:** the slide-in panel that renders a selected route's full fields **with help-text tooltips** — the "understand my data" surface.

**Deliverables:** `components/RouteDetailPanel.tsx` — props `{ route: Feature<…,CorpusRouteDetailProps> | null, onClose }`. Renders name/source badge/distance/loop/ascent/descent/quality; **`surface_breakdown` as a stacked bar** (reuse the `SurfaceBar` idea); facility fractions; attribution; source link. Each field label shows a tooltip/`title` from `corpus-field-docs`.

**Behaviors to TDD (testing-library; feed a fixture detail Feature):**
1. Renders the route name + distance + source (tracer).
2. `surface_breakdown` renders one bar segment per surface key.
3. A field exposes its `corpus-field-docs` description (e.g. `match_quality` tooltip text present).
4. `null` route → panel closed/empty; close button calls `onClose`.

**Verification:** tests green; a11y (labelled close button). **Out of scope:** map/selection wiring (C7).

---

### [x] C5 — Client: `FilterBar`  *(parallel in C*)*

**Goal:** filter controls whose state maps to the predicate consumed by C3's `buildFilter`.

**Deliverables:** `components/FilterBar.tsx` — source chips (4), distance min/max, loop toggle, quality slider, and a **color-mode toggle** (`source` ⇄ `quality`); controlled, emits a `FilterState` + `colorMode` via `onChange`.

**Behaviors to TDD:**
1. Toggling a source chip emits updated `sources` (tracer).
2. Distance inputs emit `minKm/maxKm`; loop toggle emits `loopOnly`.
3. Color-mode toggle flips `source`/`quality`.

**Verification:** tests green. **Out of scope:** applying the filter to the map (C7).

---

### [x] C6 — Client: `Legend`  *(parallel in C*)*

**Goal:** legend for route colors (by current color mode) + facility classes.

**Deliverables:** `components/Legend.tsx` — **fully prop-driven; receives the swatch colors/labels as props** (it does NOT import C3's util — in a separate worktree that file won't exist, and prop-injection keeps C6 a genuinely independent parallel WP). C7 supplies the colors from C3's utils at assembly time.

**Behaviors to TDD:** renders a swatch+label per source in `source` mode (tracer); switches to a gradient legend in `quality` mode; renders the 5 facility classes when the overlay is on.
**Verification:** tests green. **Out of scope:** map.

---

### [ ] C7 — Client JOIN: `MapExplorer`  *(client join; needs C1–C6)*

**Goal:** assemble the map — MapLibre + Carto basemap + route layer + viewport facility overlay + filter + detail panel + legend + URL sync. **Thin shell; logic already lives in tested utils/hooks.**

**Deliverables**
- `pages/MapExplorer.tsx`: `<Map>` from `react-map-gl/maplibre` with `mapStyle=` Carto dark-matter (import `maplibre-gl/dist/maplibre-gl.css`); initial view via `fitBoundsFromFeatures` (or `/stats` bbox); route `<Source>`/`<Layer line>` colored by `colorBySource`/`colorByQuality` per color mode; `filter` from `buildFilter`; click → set `?route=:id` + fetch detail + open `RouteDetailPanel`; hover highlight; facility `<Source>`/`<Layer>` (under routes) gated by the overlay toggle + `useFacilities(viewportBbox)`; `Legend`; `FilterBar`; Carto/OSM attribution.
- URL sync: `?route=:id` selects on load (deep-link); selection updates the URL.

**Behaviors to TDD (logic only — NOT the WebGL canvas):**
1. Given a `?route=:id`, on mount the detail fetch for that id fires and the panel opens (mock hooks/fetch; tracer).
2. Toggling the facility overlay enables `useFacilities` (assert the hook's `enabled` flips).
3. Filter changes from `FilterBar` update the layer `filter` prop (assert the prop, not the render).
4. Color-mode toggle swaps the layer paint expression.

> Mock `react-map-gl` (`Map`/`Source`/`Layer` as inert components) so jsdom tests
> assert **props/state wiring**. Real rendering is Phase 3.

**Gate (client package-join):** all client tests green **+ coverage ≥ 70% for `packages/client`** + lint + typecheck.
**Out of scope:** server; aesthetic polish (Phase 4).

---

### [ ] PHASE 3 — End-to-end verification  *(serial, holistic)*

**Goal:** prove the whole flow works against **live Neon**, with the coordinate-order
footgun explicitly checked.

**Steps**
- `npm run dev` (client 8080, server 3000; Vite proxies `/api/*`). Confirm `DATABASE_URL` points at live `main`.
- **Playwright** (MCP available): load `/map`; assert (a) the MapLibre canvas mounts and a non-blank basemap loads (Carto 200), (b) **routes render over land in the NY region** — sample a rendered route's coordinates via the map's queried features and assert NY bbox (the canonical "routes in the ocean" regression, end-to-end), (c) clicking a route opens the detail panel with real fields + tooltips, (d) enabling the facility overlay loads viewport segments, (e) a filter visibly reduces routes, (f) `/map?route=<real id>` deep-links to that route on cold load.
- `npm run ci` at root (lint + typecheck + coverage across packages) green.

**Gate:** all Playwright assertions pass; `npm run ci` green; manual screenshot attached to the build-log. This is the real "is it working" gate.
**Escalate (not a code failure):** Carto/Neon transient network → retry/note; live data shape drift → report as `surprises`.

---

### [ ] PHASE 4 — frontend-design polish (Tier 2)  *(serial-ish: P1 → P2 → P3)*

Driven by the `frontend-design` skill; functional correctness (Phase 3) must hold throughout.
- **P4.1 — Type + palette + atmosphere:** a distinctive font pairing (display + a **monospace for numeric data fields** to give an "instrument" feel — avoid Inter/Roboto/Space-Grotesk defaults); refine dark/lime; panel/legend treatments; subtle grain/vignette; tune the basemap to sit behind glowing routes.
- **P4.2 — Motion + states:** staggered layer-in on first paint; panel slide; hover transitions; `flyTo`/`fitBounds` on select; loading skeleton over the map; empty/error states; responsive (detail panel → bottom sheet on mobile).
- **P4.3 — a11y + attribution + final pass:** keyboard nav for filters/list, focus management on panel open, required Carto+OSM/ODbL attribution, polish pass.

These touch overlapping presentational files → run **sequentially** (or partition by file with worktrees). Each sub-step keeps tests green.
**Gate:** `npm run ci` green; a design review screenshot in the build-log; no regression in Phase-3 assertions.

---

## 8. Commits
One commit per green gate, on `feat/map-tab`: `p0: contract + fixture`, `s1: corpus-client`, … `c7: map explorer`, `phase3: e2e`, `phase4: polish`. Body: behaviors covered + gate result. Push/PR only when the human asks.

## 9. Neon lifecycle (orchestrator-owned, READ-ONLY)
1. Runtime `DATABASE_URL` → live `main` (`sweet-wildflower-00839123`), ideally a **read-only role**.
2. Integration/E2E `TEST_DATABASE_URL` → a **child branch off `main`** (so tests read realistic data without risk); skip integration cleanly if unset.
3. The app and all tests **only SELECT** — never create/alter/insert. No teardown of corpus data; drop the ephemeral test branch at the end.

## 10. Expected pauses / external prerequisites (NOT retry-loop failures)
| Condition | Why | Orchestrator action |
|---|---|---|
| `TEST_DATABASE_URL` unset | integration is opt-in | skip those tests with a clear message; unit WPs still gate |
| Carto style 404 / rate-limit | external free endpoint | switch to `positron` fallback (D4); note it |
| Live data shape drift (new source value, null field) | corpus is actively rebuilt | record as `surprises`; assert invariants not exact rows |
| Neon compute cold-start latency | autosuspend | retry once; not a failure |

**Prereqs to confirm before the WPs that need them:** read-only `DATABASE_URL` (P0); `TEST_DATABASE_URL` child branch (before S1/S3b/Phase 3); Playwright MCP reachable (Phase 3).

---

## 11. Progress (orchestrator ticks)
- [x] P0 — Foundation + frozen contract + fixture
- [x] S1 — corpus-client (DB) · [x] S2 — corpus-service + geojson · [x] S3a — error-handler · [ ] S3b — controller/routes JOIN
- [x] C1 — router shell · [x] C2 — data hooks · [x] C3 — encoding utils · [x] C4 — RouteDetailPanel · [x] C5 — FilterBar · [x] C6 — Legend · [ ] C7 — MapExplorer JOIN
- [ ] Phase 3 — E2E verification
- [ ] Phase 4 — frontend-design polish
