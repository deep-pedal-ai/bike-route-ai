# Map Tab — Build Log

Orchestrator-maintained, append-only. One entry per gate, newest at the bottom.
Branch: `feat/map-tab`.

## Conventions / standing decisions
- **Neon (read-only):** runtime `DATABASE_URL` → live `main` (`br-calm-surf-afj225jp`);
  integration `TEST_DATABASE_URL` → disposable child branch `feat-map-tab-test`
  (`br-summer-wind-afmdlndu`). App + tests SELECT only. Drop the test branch at the end.
- **Deviation (logged):** concurrent same-package WPs run in the **shared working tree,
  not git worktrees** — their files are disjoint, only the orchestrator commits, and a
  fresh worktree would not carry the gitignored `.env` (so its integration tests would
  silently skip). Files being disjoint, there is nothing to merge.
- **Deviation (logged):** during fan-out, the per-micro-WP gate is *its own test file
  green + `git diff` scope correct* (each agent runs only `npx vitest run <its file>`).
  Whole-package `tsc`/`eslint` can't pass mid-fan-out (one tsconfig compiles all of
  `src`), so whole-package typecheck/lint runs **once after the group**, and coverage
  ≥70% is gated at the join (S3b / C7) — where the plan already puts it.

---

## P0 — Foundation + frozen contract + fixture  ✅ gate: pass

**Done**
- Branch `feat/map-tab` off `main`.
- Deps: server `pg@8.21.0`, `dotenv@17.4.2`, `@types/pg@8.20.0`, `@types/geojson`;
  client `react-router-dom@7.17.0`, `react-map-gl@8.1.1`, `maplibre-gl@5.24.0`,
  `@types/geojson`; shared `@types/geojson` (dev). Lockfile committed.
  **Note for C1/C7:** react-router is **v7** and react-map-gl is **v8** (maplibre
  entrypoint `react-map-gl/maplibre`) — not the older majors.
- Frozen contract: `packages/shared/src/corpus.ts` (types only) re-exported from
  `index.ts`. `CorpusRouteProps`, `CorpusRouteDetailProps`, `FacilityProps`,
  `FacilitiesResponseMeta`, plus response aliases + `Bbox`.
- `packages/client/src/corpus-field-docs.ts` — `Record<keyof CorpusRouteDetailProps,
  string>`, descriptions adapted from `001_init.sql` column comments.
- `packages/client/src/fixtures/corpus-sample.json` — **real** data pulled from Neon
  `main`: 6 routes (all 4 sources `osm_relation|canon|generated|nysdot`, 4 loops),
  a full detail Feature (id 286, `surface_breakdown` populated), 5 facilities
  (one per class). First route first coord `[-73.21, 40.86]` (NY bbox). 7.6 kB minified.
- Env: `server/.env` (gitignored) with `DATABASE_URL` + `TEST_DATABASE_URL`;
  `.env.example` updated. `dotenv/config` wired into server `vitest.config` `setupFiles`
  and `index.ts` so the test DB URL reaches every test process (incl. subagents).
- CI coverage wiring: `src/db.ts` excluded from server `coverage.include`;
  `ci.yml` "Test with coverage" step gains `env.TEST_DATABASE_URL` from a GH secret.
  **Human follow-up:** add the `TEST_DATABASE_URL` secret in GitHub repo settings
  (a read-only child branch off main) or server integration tests skip in CI and
  server coverage can dip below 70%. Does not block local gates (`.env` present locally).

**Verification**
- Live pg+SSL connectivity smoke test passed (used to pull the fixture).
  pg@8.21 treats `sslmode=require` as `verify-full`; Neon's cert is valid → connects
  with just `connectionString`, no extra ssl config. (Relevant to S1's `db.ts`.)
- New TDD tests (client): `corpus-field-docs.test.ts` (3) + `fixtures/corpus-sample.test.ts`
  (4) → green. Field-docs exhaustive over all 20 detail keys; fixture asserts
  FeatureCollection shape + NY-bbox first coord.
- `npm run typecheck` clean (shared+server+client). `npm run lint` clean.
- Full suites unaffected: client 70/70, server 2/2.
- `git diff` scope: only `packages/**`, `docs/`, `.github/ci.yml`, lockfile. No `.env`.

**Contract is now FROZEN.** Any later change requires an orchestrator re-freeze.

---

## Fan-out — Track S {S1,S2,S3a} ∥ Track C {C1–C6}  ✅ gate: pass

Dispatched as one Workflow (9 subagents, shared tree, each running only its own
test file, returning the §7 report as structured data). No contract pressure from
any agent — the frozen contract held.

**Outcomes**
- S1 corpus-client: pass — `db.ts` lazy pg.Pool + 4 SQL-built queries; 6 integration
  tests vs the Neon test branch. Note: `db.ts` reads `DATABASE_URL`; the integration
  test redirects `DATABASE_URL=TEST_DATABASE_URL` internally so runtime stays on main.
- S2 corpus-service + geojson: the original agent finished all 4 files (22 tests) then
  **died on a transient API socket error while emitting its report** (returned null). A
  re-dispatched agent verified the on-disk files were complete + spec-conform and made
  zero edits. pass.
- S3a error-handler: pass — HttpError + central handler; 2 tests.
- C1 router shell: pass — App→layout + GeneratePage (Generate flow unchanged) + Header
  nav; existing App/Header tests router-wrapped. C2 hooks, C3 utils, C4 panel,
  C5 FilterBar, C6 Legend: all pass.

**Orchestrator gate verification (independent of the reports)**
- Two real issues the agents' type-free vitest runs could not see, fixed before commit:
  1. C2 `use-corpus-route.ts` tripped `react-hooks/set-state-in-effect` (sync setState in
     the effect body) → fix subagent moved it into the async `run` fn; tests stay green.
  2. S3a `error-handler.ts` `_next` flagged unused (mandatory 4-arg Express signature) →
     added `argsIgnorePattern:'^_'` to `eslint.config.mjs` (orchestrator-owned config;
     the codebase already used the `_`-prefix convention). Also removed a dead
     `eslint-disable no-console` directive in S1's test (a non-blocking warning).
  These two janitorial fixes (config + dead comment) were applied directly; the
  behavioral C2 fix went through a subagent.
- Whole-repo: `npm run lint` exit 0, `npm run typecheck` exit 0.
- Suites: client 22 files / 127 tests; server 5 files / 32 tests (incl. 6 live Neon
  integration). No `any` in source; no `express` import in `services/`; every WP stayed
  within its file scope (no config/contract/cross-WP edits).
- Gotcha logged: `dotenv/config` loads `.env` relative to CWD, so server tests must run
  with cwd=packages/server (`npm test -w packages/server`); running `vitest --root` from
  the repo root silently skips the integration tests. CI is fine (npm sets workspace cwd;
  the GH `TEST_DATABASE_URL` secret supplies the env var when no `.env` file exists).

**Commits:** `s1`, `s2`, `s3a`, `c1`, `c2`, `c3`, `c4`, `c5`, `c6` (one per WP).
Coverage ≥70% is gated at the joins (S3b / C7), where the plan places it.

---

## S3b — Server JOIN: controllers + routes + mount  ✅ gate: pass

**Done**
- Mounted `/api/corpus` in `app.ts` and registered the central `errorHandler` last.
- Added thin corpus controller handlers and the `/routes`, `/routes/:id`, `/facilities`,
  and `/stats` router wiring.
- Fixed the real Supertest harness flake by reusing one persistent localhost server
  per route test file, including the pre-existing `routes.test.ts` that exhibited the
  same random bare-404 behavior.

**Verification**
- `npm test -w packages/server` passed once after the harness fix, then passed **10/10**
  repeated full-suite runs against the Neon test branch: 6 files / 36 tests each run,
  with 0 intermittent 404s.
- `npm exec -- eslint packages/server` clean.
- `npm exec -- tsc --noEmit -p packages/server/tsconfig.json` clean.
- `npm run coverage -w packages/server` passed the configured ≥70% threshold.

**Notes**
- The sandboxed run cannot bind a local server or resolve Neon DNS; verification above
  was run with the required localhost + network approval.

---

## C7 — Client JOIN: MapExplorer  ✅ gate: pass

**Done**
- Assembled the `/map` surface with MapLibre, Carto dark-matter style, route and
  facility GeoJSON sources/layers, filter controls, legend, URL-backed selection,
  detail panel, and visible Carto/OSM/ODbL attribution.
- Added `MapExplorer.test.tsx` with logic-only jsdom coverage for deep-link selection,
  facility overlay enablement, filter-to-layer wiring, and color-mode paint changes.
- Updated `App.test.tsx` to mock the WebGL map boundary and assert the real Map tab
  controls instead of the retired placeholder.
- Tightened `buildFilter` to return MapLibre's `FilterSpecification` so the route
  layer consumes it without component-side casts.

**Verification**
- `npm test -w packages/client`: 23 files / 132 tests passed.
- `npm exec -- tsc --noEmit -p packages/client/tsconfig.json` clean.
- `npm exec -- eslint packages/client` clean.
- `npm run coverage -w packages/client` passed the configured ≥70% threshold.

**Follow-ups carried to Phase 3/4**
- Initial route auto-fit is still mount-only; fix with controlled view state or
  map ref `fitBounds` during Phase 4 motion/states.
- Facility bbox is still a static NY-wide query box; live viewport wiring remains
  a Phase 4 enhancement.
- Real route clicks and canvas rendering remain Phase 3 Playwright coverage.

---

## Phase 3 — Live E2E verification  ✅ gate: pass

**Done**
- Started `npm run dev` from the repo root: server on `:3000`, client on `:8080`.
- Confirmed local `.env` runtime `DATABASE_URL` and `TEST_DATABASE_URL` point at distinct
  Neon hosts; runtime stayed on the live main URL for browser verification.
- Fixed the C7 auto-fit follow-up before E2E completion: `MapExplorer` now computes a
  fitted initial zoom from loaded corpus bounds and remounts MapLibre when route data
  arrives. Added a regression test so the loaded corpus does not stay at narrow zoom 10.

**Live checks**
- `http://localhost:8080/map` loads with a mounted MapLibre canvas (`1280x656`) and
  visible Carto + OpenStreetMap/ODbL attribution.
- Carto dark-matter style returned HTTP 200.
- Live `/api/corpus/routes` returned HTTP 200 with 149 routes; first coordinate
  `[-73.585925, 43.3019744]` is inside the NY bbox. Live stats returned bbox
  `[-75.087002, 40.224332, -72.7621982, 44.184074]` and expected source counts.
- Projected live route coordinates into the fitted viewport; 7,285 route coordinates
  landed inside the visible canvas. Screenshot confirms routes render over land in the
  NYC/NY region, not in the ocean.
- Clicking a rendered live route opened `/map?route=144` with the Bear Mountain detail
  panel, real fields, and field-description tooltips.
- Facility overlay enabled successfully; live viewport query returned 2,000 features
  (`truncated: true`) from `/api/corpus/facilities`.
- Selecting the `canon` source filter visibly reduced the map to the canon subset and
  left the filter button in `aria-pressed=true`.
- Cold-loading `http://localhost:8080/map?route=144` opened the detail panel directly.
- Browser console errors/warnings: none.

**Artifacts**
- All-source map screenshot: `docs/map-tab-phase3.png`
- Canon-filter screenshot: `docs/map-tab-phase3-canon-filter.png`

**Verification**
- `npm test -w packages/client`: 23 files / 133 tests passed.
- `npm exec -- tsc --noEmit -p packages/client/tsconfig.json` clean.
- `npm exec -- eslint packages/client` clean.
- `npm run coverage -w packages/client` passed the configured ≥70% threshold.
- `npm run ci` green: lint, typecheck, client tests (133), server tests (36 with live
  Neon test branch).

**Remaining follow-up**
- Facility bbox is still static NY-wide rather than wired to live map viewport movement;
  carry into Phase 4 polish/enhancement.

---

## Phase 4 — frontend-design polish  ✅ gate: pass

**Done**
- Applied a restrained instrument-panel visual direction for the map controls and route
  detail panel: compact dark glass, lime accents, font-mono numeric readouts, formatted
  telemetry values, and sharper focus/hover states.
- Added route glow styling with a separate `routes-glow` MapLibre layer behind the main
  route line layer.
- Added loading, empty, and error status chips for routes, selected route detail, and
  facilities.
- Improved panel motion and responsive behavior: control panel entrance animation and
  route detail panel slide-in/bottom-sheet behavior on smaller screens.
- Preserved required Carto + OpenStreetMap/ODbL attribution in the UI.
- Kept accessible names for compact source and numeric controls.

**Artifact**
- Final polish screenshot: `docs/map-tab-phase4-polish.png`

**Verification**
- Browser check on `http://localhost:8080/map?route=144`: canvas mounted, detail panel
  visible, formatted route fields present, required attribution visible.
- `npm test -w packages/client`: 23 files / 133 tests passed.
- `npm exec -- tsc --noEmit -p packages/client/tsconfig.json` clean.
- `npm exec -- eslint packages/client` clean.
- `npm run ci` green: lint, typecheck, client tests (133), server tests (36 with live
  Neon test branch).
- `npm run coverage -w packages/client` passed the configured ≥70% threshold.

**Remaining follow-up**
- Facility bbox is still static NY-wide rather than tied to `onMoveEnd`; defer as a
  real-app enhancement after this map-tab build.

---

## Map-tab NL search — Phases 0–7  ✅ gate: pass

Branch: `feat/map-search-combination`. Client-only feature (no `shared`/`server` edits).
Natural-language route search on the Map tab: floating top-center search bar → results
panel slides in from the left → map filters to just those routes → hover dims the others
→ click pans+zooms (`fitBounds`) and opens the detail panel → close restores everything.
Plan of record: `docs/map-search-feature-plan.md`.

**The landmine (plan §3), neutralized.** The corpus map layer stores `properties.id` as
a **number** (`4`, `286`); `RouteSearchResult.id` is a **string**. Every id comparison
normalizes both sides to string — feature side via `['to-string', ['get','id']]`, result
side via `String(id)`. Unit tests assert a numeric feature id `4` matches a string
membership id `'4'` both ways, in `buildIdFilter`, `routeOpacityExpression`, and
`boundsForRouteId`. Confirmed fixture ids are numeric-looking, so the detail-open path's
existing `Number(routeParam)` assumption still holds.

**Done (by phase)**
- **P0** — pure map-side utils: `buildIdFilter` (id-membership, string-normalized; `[]` ⇒
  matches nothing), `boundsForRouteId` (union bounds or `null` for no-geometry),
  `routeOpacityExpression` (uniform when nothing hovered; `case` expr otherwise,
  parameterized full/dim so the casing layer can dim harder).
- **P1** — extracted `useRouteSearch` from `GeneratePage`; both pages now share it.
  GeneratePage behavior preserved (its existing test untouched and green).
- **P2** — imperative camera: replaced the `<Map key=…>` remount with a `MapRef` +
  `onLoad`; `focusBounds(bounds, opts)` → `fitBounds({padding:64, duration:600,
  maxZoom:15})`; initial fit-to-all preserved (instant, `maxZoom:10` to match the old
  `fitZoom` cap).
- **P3** — `SearchResultsPanel` slide-in (`searchPanelIn` keyframe, reduced-motion safe);
  reuses `RouteResultCard`; no-geometry results render read-only with a "no map preview"
  hint.
- **P4** — routes layer `line-opacity` driven by `routeOpacityExpression(hoveredId)`.
- **P5** — keystone: `panelOpen`/`mapFiltered`/`hoveredId` three-flag state model (not a
  single `searchActive`), `buildIdFilter` on **both** route layers (supersedes the
  FilterBar — D3), camera follows results (union fit, skipped when zero mappable),
  hover-dim, click-to-frame + open detail, close clears + restores.
- **P6** — a11y (Esc-to-close, focus into panel on open / restore to search field on
  close, `aria-current` on the open card, `role="search"` landmark + labelled textarea);
  casing layer now dims with the line; `prefers-reduced-motion` drops the slide across all
  panel keyframes; z-index ladder search(40) > detail(30) > results(20) > filter(10).

**Layout fix found by live measurement (P6)**
- The `rows=3` search bar renders **164px** tall; the first estimated reserved band
  (`9.25rem`) overlapped it by ~28px. Measured `getBoundingClientRect` in a real browser
  and corrected all three floating panels to `top-48` (12rem) → verified clean 16px gap,
  no overlap.

**Artifacts**
- `docs/screenshots/map-search-closed.png` — search bar + FilterBar, no overlap.
- `docs/screenshots/map-search-open.png` — panel open, "3 routes matched", relaxed notice,
  mappable cards + a "no map preview" card, map framed to the results. (UI demo with
  mocked `/api` data, not live corpus output.)

**Verification**
- `npm run ci` **green** (exit 0): lint + typecheck + tests across all packages —
  client **149 tests**, server **44 tests** (incl. live Neon-test-branch integration).
- Live browser walkthrough (Vite dev server, mocked `/api` endpoints): search → panel
  slides in → FilterBar hidden → 2 mappable focus-cards + 1 "no map preview" → camera
  framed the routes; close path restores the FilterBar and full filter.
- Red-first discipline: the keystone hover test was confirmed non-vacuous (breaking the
  `onHover` wire fails it).

**Scope honored**
- No edits to `@bike-route-ai/shared` or `packages/server`. Entire feature is client-only.

**Note**
- Phases 0–5 were captured in commit `0517355` (made outside this agent's actions); the
  P6 polish remains in the working tree, uncommitted, per "commit only when asked."
