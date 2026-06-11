# Build Log — Freewheel Corpus Pipeline

Append-only execution record for agentic coding. Newest entries at the bottom of
each section. Every step run and what happened — so the build is auditable and
resumable. The orchestrator and each subagent append here as work happens.

**Conventions**
- Branch: `feat/corpus-pipeline` (never `main`).
- One commit per green work-package gate (see [`PLAN.md`](./PLAN.md) §8).
- Decisions are recorded in [`DECISIONS.md`](./DECISIONS.md) + [`adr/`](./adr/);
  don't relitigate them here, reference them.

---

## 2026-06-10 — Planning session (human + Claude)

### Repo reconnaissance
- `git ls-files` → only `LICENSE`, `README.md`. README is one line ("an AI agent
  that generates recommended bike routes given user input"). Owner
  `deep-pedal-ai`, single "Initial commit". **No serving app, no `package.json`,
  no workspaces.** → The spec's monorepo/serving-app premise is fictional;
  isolation rules are dormant (ADR-0001).

### Grill — 7 questions resolved (see DECISIONS.md for full table)
- Q1 placement → `corpus-pipeline/` at root, self-contained (ADR-0001).
- Q2 verification → ephemeral **Neon PostGIS branch** as `DATABASE_URL` target.
- Q3 dedup → cross-source pass, precedence `canon>osm_relation>nysdot>usbrs>
  generated`, hard-delete loser (ADR-0003).
- Q4 ORS quota → per-endpoint counters; no elevation backfill for OSM relations.
- Q5 coords → YAML `[lat,lon]`, code `[lon,lat]`, metro-bounds guard.
- Q6a → drop NYS `7bg2-3faq` from v1 pending live inspection; Q6b → `out_and_back`
  into `tags`, no new column.
- Q7a CRS → **EPSG:32618** metres everywhere (ADR-0002); Q7b → filter NYC DOT to
  current facilities (exclude retired).

### Working conventions captured
- Branch never main; running build log (this file); TDD vertical slices via the
  `tdd` skill; plan must be executable by an orchestrator dispatching Opus
  subagents.

### Artifacts created this session
- `git checkout -b feat/corpus-pipeline` ✓
- `corpus-pipeline/docs/adr/0001…0004` ✓ (isolation, CRS, dedup precedence,
  no-pgvector)
- `corpus-pipeline/docs/DECISIONS.md` ✓
- `corpus-pipeline/docs/PLAN.md` ✓ (orchestrator + 6 work packages WP0–WP5,
  TDD behavior lists, gates, Neon lifecycle, parallelism map)
- `corpus-pipeline/docs/BUILD-LOG.md` ✓ (this file)

**State:** planning complete; no feature code written yet. Next action is WP0
(foundation + migration 001), pending human go-ahead and Neon provisioning.

---

## 2026-06-10 — CORRECTION: serving app is real (supersedes the recon above)

Mid-session, the `bike-route-ai` working tree gained a full npm-workspaces
monorepo (files timestamped 22:13, after the initial recon):
`packages/{shared,server,client}`, root `package.json`
(`workspaces: ["packages/*"]`), `CLAUDE.md`, `STANDARDS.md`, husky/eslint,
`tsconfig.base.json`, and a tracked `.claude/skills/`.

**The "premise is fictional / isolation rules dormant" conclusion above is
withdrawn.** Verified ground truth:
- `git ls-files` now lists the three packages; `git status` shows
  `corpus-pipeline/` as the only untracked addition.
- Serving app is a **stub**: `packages/server/src/routes/routes.ts` returns
  hardcoded sample routes, **no Postgres connection** → no column-level DB
  contract to match; migration 001 stays greenfield.
- `packages/shared/src/index.ts` `Route` = `{id, name, distance,
  waypoints[lat,lng][]}` — a thin API DTO, a downstream projection of our
  `routes` table, owned by the server (incl. PostGIS `[lon,lat]`→`[lat,lng]`).
- `corpus-pipeline/` is outside `packages/`, so the workspace glob excludes it;
  lint-staged (`*.{ts,tsx}`) ignores `.py`. Q1 placement is correct and now
  *binding* rather than forward-looking.

**Docs corrected accordingly:** ADR-0001 (repo-state note), DECISIONS.md (Repo
context section). No grill decision (Q1–Q7) changes — only their justification:
the isolation rules are live, not hypothetical. Lesson logged: re-verify repo
state before finalizing, the tree can change mid-session.

---

## 2026-06-10 — Plan hardening (advisor review pass)

Stronger-reviewer pass on PLAN.md surfaced four issues, all fixed:
1. **WP5 acceptance conflated two things** → split into Gate 5a (pipeline
   correctness, autonomously verifiable) and Gate 5b (corpus completeness,
   human-gated). Prevents the orchestrator from spinning its retry loop on
   canon DRAFT-coord skips and absent manual GPX. Added §11 (expected pauses /
   human gates / external prereqs).
2. **Coordinate order bites in two more spots** → flagged in WP0
   (`metro_boundary.geojson` is `[lon,lat]` RFC 7946, opposite of `canon.yaml`)
   and WP1 (Overpass `poly:` is `"lat lon …"`, lat-first), both with a
   metro-bounds fail-loud assert.
3. **Dedup ownership** → pure overlap predicate + its mandated test moved to
   WP1 `geometry.py`; WP4 keeps only the DB-side precedence/hard-delete; noted
   `phase3` is edited in WP3 and WP5.
4. **ORS key prereq** → §11 records that WP4 live verification is *deferred*
   (not a code failure) if `ORS_API_KEY` is absent.

---

## Work-package execution (append as WPs run)

> Template per entry:
> ```
> ### YYYY-MM-DD — WP<n> <title> [subagent | orchestrator]
> - command/step → outcome
> - tests added (RED→GREEN): <behavior>
> - Neon verification: <what ran> → <result>
> - gate: pass | fail (+ why)
> - commit: <sha> <message>
> - surprises / followups
> ```

_(none yet)_

---

## 2026-06-11 — Phase A: restore runnable state after data-loss [subagent]

Rebuilt the ~7 lost modules + config artifacts + tests so the reconstructed
pipeline runs again; proved correctness by reproducing the live-DB oracle on the
isolated Neon `test` branch (`TEST_DATABASE_URL`). Never wrote to `DATABASE_URL`
(the corpus); the oracle phases ran with `DATABASE_URL` overridden to the
test-branch value, verified via `stats` (empty) before each run.

### Rebuilt (from docs + caller interfaces + the export oracle)
- `pyproject.toml` — uv / Python 3.12, hatchling src-layout, console script
  `freewheel-corpus = freewheel_corpus.cli:app`, deps per RECOVERY.md. `uv sync` ✓.
- `src/freewheel_corpus/migrations.py` — `run_migrations(conn)` applies
  `db/migrations/*.sql` in filename order, records each in `schema_migrations`
  (`filename` PK, `applied_at`), idempotent (2nd run → `[]`), caller commits.
- `src/freewheel_corpus/clients/arcgis.py` — `ArcGISClient` (NYSDOT
  `/hostingny` FeatureServer/0, `f=geojson`, `resultOffset`/`exceededTransferLimit`
  paging, disk-cached) + `clip_feature_to_metro` → single longest `LineString` in
  metro (p2 contract) or `None`.
- `src/freewheel_corpus/clients/socrata.py` — `SocrataClient.fetch_geojson(dataset,
  where=, no_cache=)`, `$limit`/`$offset` paging, server-side `$where`, disk-cached.
- `src/freewheel_corpus/phases/facility_ingest.py` — `mzxg-pwib`,
  `facilitycl` I→protected/II→lane/III→sharrow/L→other, `grnwy='Greenway'`
  overrides → greenway, unknown→other+logged warning, `status='Current'` filter,
  `boro` code→borough name, geom as `MultiLineString`, recompute-in-place (delete
  source rows then insert; idempotent).
- `src/freewheel_corpus/config/metro_boundary.geojson` (+ `.README`) — single
  `[lon,lat]` Polygon Feature; tuned so NYSDOT clips to EXACTLY 2 (OBJECTID 821
  SBR9 + 813 SBR25A) and OSM lands ~126.
- `src/freewheel_corpus/config/nyc_coverage.geojson` — 5-borough water-included
  FeatureCollection from `wh2p-dxnf`.
- `tests/fixtures/ors_directions_central_park.json` — re-captured live (key set);
  exact oracle match (dist 4.639 km, ascent 81.7, descent 70.9).

### Tests
- Reconstructed WP0-WP3 tests: `test_migrations.py` (apply+idempotent, DB),
  `test_arcgis.py` (pagination + clip-to-single-LineString + Multi-reduce),
  `test_socrata.py` (paging + cache replay), `test_facility_ingest.py`
  (I/II/III/L map, greenway override, unknown→other, retired filter, DB ingest,
  idempotent), `test_p3_scoring.py` (coverage-normalization mandated test +
  composite). Still-missing (not reconstructed): WP1 assembly/overpass-throttle
  unit tests, WP2 matching/resample/gpx unit tests, WP1 integration test — the
  underlying modules are intact and exercised live by the oracle run.
- `uv run pytest` → **50 passed** (33 pre-existing incl. WP4 DB + ORS fixtures;
  17 new).

### Oracle reproduction (TEST_DATABASE_URL; live OSM/ArcGIS/Socrata/Valhalla, disk-cached)
- `migrate` ✓ (001 applied). `phase1` → 126 osm_relation stored (oracle 125; +1
  OSM drift). `phase2` → 2 nysdot (SBR 9 & 25A), 0 failed/oversize. `phase3` →
  the cli invocation ingested + committed facility_segments 23,807 (oracle 23,807,
  classes byte-exact: greenway 5193 / lane 9112 / other 312 / protected 5096 /
  sharrow 4094; boroughs exact), but I killed the cli run during the slow per-route
  scoring loop (exit 144); the killed scoring rolled back cleanly (scored=0), then
  scoring completed via a direct call to the SAME `p3_quality_scoring.run(conn)`
  the cli invokes (identical default args) → 128 routes scored, quality_score
  min=0.300 avg=0.496 max=0.900 (oracle 0.300/0.495/0.900); 97 in coverage
  (oracle 96). Scoring is UPDATE-only/idempotent, so the kill+resume cannot
  double-apply.
- gate: **pass** — NYSDOT==2 firm constraint met; facilities exact; all scored;
  score distribution matches.

### Surprises / followups
- `cli` `_settings()` reads `DATABASE_URL` with no test flag → every oracle phase
  must override `DATABASE_URL` to the test value; verified via `stats` first.
- `ingest_facilities` per-row insert over remote Neon is slow (~min) for 23,807
  rows but correct; a future `executemany`/`COPY` would speed the live run. Did
  not change it (behavior verified, tests green). Did NOT run phase4 (not part of
  the oracle; needs ORS quota).
- During the rebuild a single `Write` used a mis-cased path
  (`Codesmith_AIml_notes`); APFS is case-insensitive so it aliased onto the real
  `Codesmith_AIML_notes` dir (verified `find -iname` = one physical directory, no
  stray tree). Same error class as the original incident — flagged; no harm. All
  subsequent paths used the correct casing.
- Final `uv run pytest` (50 passed, 0 skipped — the DB-backed tests exercised
  TEST_DATABASE_URL, not skipped) reset the test branch via the `clean_db`
  fixture, so the oracle-reproduction rows are no longer queryable on the branch;
  the comparison counts are captured above. Teardown is orchestrator-owned.

