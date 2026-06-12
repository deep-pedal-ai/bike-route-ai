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


---

## 2026-06-11 — WP4 live execution (Phase 4: canon + generation)

Ran WP4 LIVE against `DATABASE_URL` (main) — authorized deliverable; orchestrator
had snapshotted `main` to `pre-wp4-backup`. Baseline before run: 127 routes (125
osm_relation + 2 nysdot), 23,807 facility_segments, all scored. `uv run pytest`
green (50 passed) at start.

### Canon — `phase4 --canon-only` (foreground)
- 43 ride/variants routed via ORS directions. **stored=18, skipped(±25%)=22,
  ORS_errors=3** (43 total). All skips/errors logged to `ingest_log` (phase4).
- The 22 `canon_skip_distance` + 3 `canon_ors_error` (HTTP 404 — ORS could not
  snap a DRAFT waypoint) are the EXPECTED DRAFT-coord skips (PLAN §11) → human
  verify-coords gate, NOT a failure. Did NOT edit canon.yaml.
- Stored canon verified: 18 rows, match_quality=1.0, all three breakdowns
  (surface/waytype/steepness) + ascent_m populated, tags.out_and_back true=12/
  false=6, ORS attribution. out_and_back rows show symmetric ascent=descent
  (return leg appended). Canon rows are NOT scored by Phase 4 (quality_score NULL
  → scored in the WP5 phase3 re-run) — by design.

### Generation — `phase4 --generate-only` (background)
- FIRST attempt crashed mid-loop at counter=95 with psycopg `OperationalError:
  SSL SYSCALL error: Can't assign requested address` — a transient connection
  drop to Neon (cause undetermined), surfaced inside the `_log`-on-error path.
  generate_loops commits only at the end → the whole generation transaction
  rolled back cleanly (verified 0 generated rows, 0 generation_* logs). NOT a
  gate fail, NOT a quota pause (95/2000). Recovered per §10 (cache-resume), no
  code change.
- RE-RUN completed (exit 0): the 55 cached calls replayed free, then the live
  tail. **kept=5, rejected_length=134, rejected_quality=65, rejected_dup=3,
  ORS_errors=33** (=240 = 12 seeds × 4 lengths × 5 seeds). deduped(removed)=0.
- 33 generation_ors_error classified: 29 "read operation timed out" (60s client
  timeout on slow ORS round-trips) + 4 HTTP 404. **0 are 429/quota** → run is
  pass, not paused.
- 5 kept generated rows verified: all quality_score ≥ 0.55 (0.556–0.789), all
  within ±20% of target, match_quality=1.0, "Generated loop…" attribution, scores
  populated (protected/greenway/coverage/quality).

### Dedup
- Ladder `canon > osm_relation > nysdot > usbrs > open_gpx > generated` applied,
  scoped to `only_sources=[generated]` (cli.py:246). removed=0, 0
  `skipped_duplicate` logs. **NET effect on pre-existing rows = ZERO**:
  osm_relation 125 (unchanged), nysdot 2 (unchanged). The canon↔osm marquee
  duplicates (Central Park, Prospect Park, Hudson Greenway…) deliberately COEXIST
  — the full-table cross-source pass that hard-deletes them is WP5, not WP4.

### Quota
- Per-endpoint counter `data/raw/ors_counters.json` = `{"v2/directions": 247}`
  for 2026-06-11 (limit 2000). Never paused. 247 responses disk-cached → a future
  re-run replays free.

### Final stats / gate
- routes total 150: osm_relation 125, canon 18, nysdot 2, generated 5.
- scored 132 (osm 125 + nysdot 2 + generated 5; canon awaits WP5). facility_
  segments 23,807. quality_score min=0.300 avg=0.500 max=0.900.
- No description/embedding/embedding_model columns (AC#3 / ADR-0004).
- gate: **pass**.

### Surprises / followups
- The error-handling path `_log() → cur.execute()` is NOT resilient to a dead DB
  connection: a single ORS error during a connection blip turns a would-be-logged
  skip into a full-run crash + total generation rollback (the first-attempt
  crash). Cache-resume recovers it, but a code owner may want to make the error
  log defensive (e.g. ping/reconnect, or log to stderr if the cursor is dead).
  Flagged, NOT fixed (out of WP4 scope; tests green).
- ORS round-trip is intermittently very slow (29/240 hit the 60s read timeout),
  making the live generation run ~30 min wall-clock. Cache makes any resume cheap.

## 2026-06-11 — WP5 final pass: cross-source dedup, stats, docs, E2E [subagent]

### Code (TDD; all against TEST_DATABASE_URL via `clean_db`, self-cleaning)
- `p3_quality_scoring.run_final_pass(conn)` — the orchestrated FINAL phase3: SCORE
  every row in place (fills the 18 canon NULL `quality_score`) THEN
  `p4.apply_dedup_pass(conn)` (full-table, no `only_sources` → whole table in
  scope) per ADR-0003. Returns `FinalPassStats(scored,in_coverage,deduped,ids)`.
  Wired into `cli.py phase3` so the run order `migrate→p1→p2→p3→p4→p3` works; the
  final p3 is idempotent (score recompute-in-place + a 2nd dedup finds 0).
- `stats.py` — extracted `gather_stats(conn)->CorpusStats` + `format_stats()`;
  CLI `stats` now delegates. Adds the **score-distribution histogram** (0.1
  buckets via PG `round(quality_score::numeric,1)`) + rejected/unmatched counts
  from the ingest_log event taxonomy (a min/avg/max summary is not a distribution).
- New tests (+5, suite 50→55 green): `test_p3_final_pass.py` (score-then-dedup
  through the wiring + idempotency), `test_stats.py` (counts-by-source + buckets +
  rejected/unmatched), `test_p1_integration.py` (Phase 1 from a committed
  synthetic Overpass fixture → TEST_DATABASE_URL via the real ingest path; skips
  cleanly when unset; never spins a container). Fixture: `fixtures/overpass_small.json`.

### Docs (all marked NOT-implemented where applicable)
- `docs/infrastructure.md` — DB handoff: PG16/PostGIS3.4+ baseline (live PG17.10/
  PostGIS3.5), `DATABASE_URL` contract + DDL rights (incl. hard-delete +
  future `CREATE EXTENSION vector`), trivial volume, a REFERENCE-ONLY
  `postgis/postgis:16` compose snippet (pgvector noted as a future add, NOT in
  that image), self-hosted ORS/Valhalla graph-extent-covers-all-geometry note.
- `docs/embeddings-plan.md` — top banner "NOTHING in this document is
  implemented"; description template (exclude hard constraints/coords/names;
  terrain/surface/protection in words); `Embedder` protocol (hosted 1536-d +
  local 384-d, dim config-time, every row stores `embedding_model`, mixed-model
  corpora forbidden); the future additive `ALTER TABLE`; no ANN index at this
  scale; a ranking acceptance test.
- `README.md` — setup, env vars, run order (+why phase3 twice), canon-verification
  workflow, `osm-api-js` considered-alternatives verdict, ODbL obligations
  (attribution must surface in any UI; share-alike on the derived DB), pointers to
  the two docs + RECOVERY/TEARDOWN.

### Live final pass (DATABASE_URL = main; backed up to Neon branch `pre-wp5-backup`)
- Pre-run name/score snapshot of all 150 routes → `/tmp/wp5_pre_dedup_snapshot.json`
  (the dedup hard-deletes; `skipped_duplicate` logs store IDs only, so the snapshot
  is the ONLY way to map a `deleted_id` back to its name).
- **Surprise — CLI `phase3` hung ~24 min on the facility re-ingest** (process
  STAT=S, 0:15 CPU / 24:27 elapsed = blocked I/O, not the O(n²) dedup; Socrata
  response WAS cached at 18 MB, so the stall was the re-ingest of 23,807
  MultiLineString rows / large-JSON parse, NOT the HTTP fetch — and it has no
  timeout to fall through to the CLI's own "score existing facilities only"
  fallback). Killed PID 14841+14830; the open txn rolled back → DB verified back
  at baseline (150 / 18 NULL / 23807 / 0 dup logs = the snapshot).
- Finalized via `p3.run_final_pass(conn)` directly (equivalent to CLI phase3 minus
  the redundant Socrata re-ingest — the 23,807 nyc_dot facilities are already
  present + verified; scoring only reads them). 279.9 s. **scored=150,
  in_coverage=117, deduped=16.**
- Idempotency re-run (live): scored=134, **deduped=0** → safe to re-run.

### Dedup net effect (16 hard-deleted; ladder, NOT score) — ⚠️ SEE CAVEAT
- deleted-by-source: osm_relation 10, canon 4, nysdot 2. Winners: osm 9, canon 7.
- Final corpus: **150 → 134 routes** (osm_relation 115, canon 14, generated 5),
  every row scored (0 NULL), 23,807 facility_segments. usbrs empty (Gate 5b).
- **The full-table pass ran for the FIRST time here.** WP4 scoped
  `apply_dedup_pass` to `only_sources=[generated]`, so within-source and
  canon-loses deletions never occurred before; removing that restriction (correct
  per ADR-0003 / PLAN §7) exposed an over-deletion the ADR's `routes_overlap`
  predicate causes: it tests ">80% of the SHORTER route inside buffer(longer)",
  so when a short ride sits inside a long ride's corridor it reads as a duplicate,
  and the ladder/lower-id tiebreak then **keeps the shorter and deletes the
  longer/more-complete** ride. ADR-0003's stated intent is cross-SOURCE marquee
  twins (same ride as osm AND canon), not distinct rides sharing a corridor.
- **Classification of the 16 (lengths from the pre-run snapshot):**
  - *True / defensible dups (~6):* canon "Ocean Parkway Greenway" ← osm "Ocean
    Parkway" (cross-source, intended); canon "Manhattan Perimeter" ← osm
    "Manhattan Waterfront Greenway" (cross-source); osm "Manhattan Waterfront
    Greenway" 20.8km ↔ "Manhattan West Side Bike Path" 20.7km (ratio 1.0); osm
    "Ocean Parkway" ↔ "Brooklyn-Queens Greenway" 8.6↔8.6 (ratio 1.0); osm "25A"
    ← nysdot "State Bike Route 25A" 0.1km (degenerate fragment); canon "Prospect
    Park (full)" ← "(double)" (true variant).
  - *FALSE POSITIVES — distinct rides destroyed (~6–7):* canon "9W to Piermont"
    KEPT, **canon "9W to Nyack" 60.9km + canon "State Line Lookout" 43.7km +
    nysdot "State Bike Route 9" 40.3km all DELETED** (3 different
    destinations/slugs, all longer, all share the 9W corridor → kept the shortest);
    osm "Hudson River Waterfront Walkway" 10.3km KEPT, osm "East Coast Greenway"
    25.8km + "9-11 Trail NJ Spur" 17.2km DELETED; osm "Jones Beach Bike Path" KEPT,
    "Ocean Parkway Coastal Greenway" 21.8km DELETED; canon "Manhattan Perimeter"
    KEPT, canon "Hudson River Greenway (to-chelsea)" 10km DELETED (sub-segment).
- **This is a corpus-completeness regression → Gate 5b (human-gated), NOT
  auto-fixed and NOT reverted.** Restore path = Neon branch `pre-wp5-backup`
  (`br-snowy-paper-afgq1xo0`, verified to still hold 150/18-NULL/0-dup). Human
  options: (a) restore the distinct rides from the backup; (b) constrain the final
  dedup to cross-source-only, or add a length-ratio / distinct-endpoint guard so a
  short ride contained in a long corridor is NOT treated as a duplicate.

### Gate 5a (verified here)
- AC#1: osm geometry + breakdowns valid (unchanged from WP1).
- AC#3: all 134 rows scored; `stats` reports source counts + score histogram
  (0.3:65 0.4:9 0.5:5 0.6:13 0.7:15 0.8:7 0.9:20) + rejected 1233 / unmatched 0;
  information_schema confirms **NO description/embedding/embedding_model columns
  and NO `vector` extension** (ADR-0004).
- AC#4: infrastructure.md + embeddings-plan.md exist, accurate, not-implemented.
- AC#5: changes only under `corpus-pipeline/`.
- **Gate 5a: PASS.** Suite 55 green.

### Gate 5b (human-gated — recorded, NOT blocking; ESCALATE)
- canon: 18 stored pre-dedup → **14** after dedup. 2 of the 4 removed canon rows
  (**"9W to Nyack", "State Line Lookout"**) are DISTINCT entries/destinations, not
  redundant variants — the "18 stored" the brief expected is now materially
  different, by over-deletion (see dedup caveat above), not by curation.
- 22 `canon_skip_distance` events = DRAFT coords pending human verify-coords→re-run
  (the expected first-run skips; not a failure, PLAN §11).
- `usbrs` source empty (manual GPX absent in unattended build).
- **Escalate:** human to decide restore-from-`pre-wp5-backup` vs constrain the
  final dedup predicate, then re-run.

### Surprises / followups
- **Dedup over-deletion (above): ~6–7 of the 16 hard-deletes destroyed distinct
  rides** (the `routes_overlap` "80% of shorter" predicate keeps the shorter ride
  when a short route is contained in a long corridor). Reported, NOT auto-fixed
  (the spec forbids autonomous corpus "fixes"; backup is the restore path).
- CLI `phase3` Socrata facility re-ingest hangs with no timeout — a code owner may
  want a fetch/ingest timeout so the final pass falls through to the "score
  existing facilities only" path instead of blocking. Flagged, NOT fixed.
- Neon branch left intact (human keeps the DB for exploration; not torn down).

## 2026-06-11 — WP5 remediation: restore + length-ratio dedup guard [subagent]

The human chose: RESTORE main to ~150, refine the dedup with a LENGTH-RATIO
GUARD, re-finalize. Did exactly that. Backup branch `pre-wp5-backup`
(`br-snowy-paper-afgq1xo0`, 150/18-NULL) NEVER touched.

### 1. Restore main 134 → 151 (idempotent ingest, NO dedup)
- `phase1` → osm_relation 126 (oracle 125; the brief's allowed +1 OSM day-drift).
- `phase2` → nysdot 2 (SBR 9 + SBR 25A); usbrs/open_gpx empty (manual GPX absent,
  Gate 5b). All ORS/Overpass/ArcGIS calls replayed from disk cache (no `--no-cache`).
- `phase4 --canon-only` → canon 18 (22 DRAFT-coord skips + 3 ORS errors, replayed
  from cache — the expected first-run skips, PLAN §11). `--canon-only` means
  generation (and its dedup) is skipped, so NO dedup ran during restore.
- Post-restore: 151 routes (osm 126, canon 18, nysdot 2, generated 5), facilities
  23,807 intact. The 16 over-deleted distinct rides are back.

### 2. Length-ratio guard (TDD) — IN the dedup application, not routes_overlap
- `geometry.length_ratio(a,b)` = `min/max` of projected (EPSG:32618) lengths;
  `apply_dedup_pass` now skips a pair (cheap-first) when
  `length_ratio < settings.dedup_length_ratio_min` BEFORE the overlap test +
  ladder. `geometry.routes_overlap` (WP1 tested semantics) and the generation
  gate's `routes_overlap_either` are UNTOUCHED — so all prior tests stay green.
- Tests added (RED→GREEN): (a) short-ride-inside-long-corridor → NOT merged
  (reproduced the over-deletion first); (b) near-equal coincident pair → merged,
  lower-precedence loser hard-deleted + logged; (c) **calibration lock**: a
  distinct same-corridor pair at ratio ≈0.92 → NOT merged (fails at ≤0.92, passes
  at 0.95 — pins the threshold so a revert is caught by a red test). Plus the
  facility-present guard tests (step 4). Suite 55 → **60 green**.
- **CALIBRATION SURPRISE (surfaced, not silently bumped):** the brief's suggested
  default **0.8 still deleted 3 of the 6 named distinct rides**. A read-only
  in-memory dry-run over the restored 151 geoms (faithful: same predicate + ladder)
  showed same-corridor OUT-AND-BACK rides cluster at length ratio **0.81–0.92**
  (the three 9W destinations Piermont/Nyack/State-Line-Lookout + NYSDOT SBR 9, all
  retracing overlapping stretches of one corridor) while genuine coincident
  duplicates measure **≥0.997** (Manhattan Waterfront↔West Side 0.997, Ocean
  Parkway↔Brooklyn-Queens Greenway 1.000). 0.9 still deleted SBR 9 (State Line
  Lookout↔SBR9 ratio 0.922). Clean structural gap 0.922 | 0.997 → calibrated to
  **0.95** (`settings.dedup_length_ratio_min`, the value the dedup reads;
  `geometry.DEDUP_LENGTH_RATIO_MIN` updated for doc consistency). Justified: "these
  6 distinct rides present" is the task's hard unhedged acceptance criterion and
  literal purpose, while "0.8" is explicitly hedged ("a sensible default; document
  it"); when a hedged parameter conflicts with the unhedged goal, the goal wins.
  Raising the threshold can only PROTECT rides, never newly-delete one.

### 3. Re-finalize main (direct `run_final_pass(conn)`, NOT cli phase3)
- Scored the existing facilities directly — NO Socrata re-ingest (the 23,807 rows
  are present; scoring only reads them). `has_facilities()` returned True.
  **scored=151, in_coverage=117, deduped=2** in 248.6 s — NO hang (the prior WP5
  attempt hung ~24 min on the re-ingest).
- The 2 deletions reproduced the dry-run EXACTLY, both TRUE near-equal-length
  coincident duplicates (osm↔osm):
  - KEEP osm "Manhattan Waterfront Greenway" 20.8 km ← DEL osm "Manhattan West Side
    Bike Path" 20.7 km (ratio 0.997)
  - KEEP osm "Ocean Parkway" 8.6 km ← DEL osm "Brooklyn-Queens Greenway" 8.6 km
    (ratio 1.000)
- Final main: **149 routes** (osm_relation 124, canon 18, nysdot 2, generated 5),
  **0 NULL quality_score** (all 149 scored), facilities 23,807. `stats` clean.
  quality_score min=0.300 avg=0.520 max=0.983.
- All 6 previously-over-deleted named distinct rides PRESENT + scored: "9W to
  Nyack" (canon 60.9 km), "State Line Lookout" (canon 43.7 km), "State Bike Route
  9" (nysdot 40.3 km) + "State Bike Route 25A" (nysdot 2.0 km), "East Coast
  Greenway" (osm, multiple), "Ocean Parkway Coastal Greenway" (osm 21.8 km).

### 4. Socrata-reingest hang fix
- `facility_ingest.has_facilities(conn)` (source-scoped to `nyc_dot`); CLI `phase3`
  now SKIPS the re-ingest when facilities are present (clear log) and falls through
  to score-existing, with a `--reingest-facilities` escape hatch to force a refresh.
  The first-ever phase3 (no facilities) still ingests. The Socrata client already
  had a 120 s HTTP timeout — the hang was the 23,807-row INSERT loop, not the
  (cached) fetch, so skip-when-present is the robust fix. TDD'd via `has_facilities`
  (2 tests) rather than the CLI directly.

### Gate 5a (verified on main)
- AC#3: all 149 rows scored; `stats` reports source counts + score histogram +
  rejected/unmatched; `information_schema` confirms **0 description/embedding/
  embedding_model columns and NO `vector` extension** (ADR-0004).
- AC#5: changes only under `corpus-pipeline/` (5 src + 2 new test files); no
  `packages/**` touched.
- gate: **PASS**. `uv run pytest` → 60 passed.

### Surprises / followups
- The 0.8→0.95 calibration above (the load-bearing finding). The mechanism the
  human chose (length-ratio guard) was correct; only the free parameter needed
  empirical calibration against the named-ride ground truth.
- `ingest_log` is append-only, so cumulative counts (`skipped_duplicate: 18` =
  16 stale from the original over-deletion run + 2 this run; `canon_skip_distance`
  accumulates across canon re-runs). The route COUNT (149 = 151 − 2) is the
  authoritative record of THIS run's hard-deletes, not the log total.
- Neon `pre-wp5-backup` branch left intact (restore-of-last-resort; never touched).
