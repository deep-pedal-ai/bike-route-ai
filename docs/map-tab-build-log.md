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
