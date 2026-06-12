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
