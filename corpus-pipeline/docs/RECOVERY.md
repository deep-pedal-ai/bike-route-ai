# RECOVERY / HANDOFF — Freewheel Corpus Pipeline (2026-06-11)

This is the authoritative handoff after an accidental local file deletion during
WP4. **Read this first.** The valuable deliverable — the corpus — is intact; the
loss was local code only. See `INCIDENT-DATA-LOSS-2026-06-11.md` (repo root) for
the raw incident account.

---

## TL;DR

- ✅ **The corpus is safe.** The Neon database was never touched: **127 routes**
  (125 OSM relations + 2 NYSDOT), **23,807 facility segments**, **every route
  scored**. Also exported locally to `corpus-pipeline/exports/`.
- ✅ **Docs + serving app recovered** from the git remote.
- ⚠️ **The pipeline *code* is partially reconstructed** (28 files, byte-faithful
  from the session transcript) but **does not run as-is** — ~7 modules + the
  WP0–WP3 tests/fixtures + `pyproject.toml` were lost and were deliberately **not
  fabricated**. Rebuilding them was paused at your request ("secure + hand off").
- ❌ **No local backup exists (VERIFIED 2026-06-11).** The earlier "try iCloud first"
  hope was wrong — checked on the machine: `~/Documents` is **not** synced to iCloud
  ("Desktop & Documents Folders" is off, no `Documents` folder in iCloud Drive
  storage), **Time Machine** has no destination configured, and APFS has only
  `os.update` snapshots (no user-data snapshot). Google Drive exists but the project
  lived under `~/Documents`, not inside it. So the deleted tree was local-only and is
  **not** recoverable from a backup. The reconstruction below + the live DB are the
  recovery basis. (Undelete/file-carving is a low-odds last resort: APFS SSD + TRIM
  zeroes freed blocks fast, and writes since the deletion lower the odds further.)

---

## What happened (one paragraph)

A WP4 subagent dispatched by the orchestrator ran `rm -rf` on a **mis-cased path**
(`Codesmith_AIml_notes`). macOS APFS is **case-insensitive**, so it resolved to the
real `Codesmith_AIML_notes` and recursively deleted `deeppedal/bike-route-ai` in
full — `.git` history (the WP0–WP3 commits, never pushed), the serving-app
monorepo, `.env`, and the in-progress WP4 work. `rm` bypasses Trash.

---

## What is INTACT

### The corpus (the deliverable) — Neon, untouched
- Project **`freewheel-corpus`** (`sweet-wildflower-00839123`), org **Permaflux**.
- `main` branch (`br-calm-surf-afj225jp`): 127 routes, 23,807 facility_segments,
  all 4 score columns populated on every route. PostGIS 3.5 / PG 17.10.
- `test` branch (`br-withered-mountain-af1fd7ss`): isolated test DB.
- Reach it via `corpus-pipeline/.env` → `DATABASE_URL` (restored). Explore/teardown
  steps in `docs/TEARDOWN.md`.

| source | count | notes |
|--------|-------|-------|
| osm_relation | 125 | Phase 1 — Overpass, valid geom, match_quality 1.0, ODbL |
| nysdot | 2 | Phase 2 — State Bike Routes 9 & 25A, Valhalla map-matched |
| **total** | **127** | quality_score range 0.300–0.900 (avg 0.495); 96 in NYC coverage |

> Phases 4 (canon + generation) and the dedup/cross-source pass never ran, so no
> `canon`/`generated` rows exist — that work was interrupted by the incident.

### Local, Neon-independent export — `corpus-pipeline/exports/`
- `routes.geojson` — 127 features (geometry + properties); open in geojson.io / QGIS.
- `routes.csv` — tabular incl. WKT geometry + all scores.
- `facility_segments.csv` — 23,807 rows. `ingest_log.csv` — 1,256 audit events.
- `schema_migrations.csv`. **Schema DDL** = `src/freewheel_corpus/db/migrations/001_init.sql`
  — **verified column-for-column against the live DB (2026-06-11): exact match** on all
  three tables (`routes` 26 cols, `facility_segments` 9, `ingest_log` 9), so this
  reconstructed file is a trustworthy schema-of-record for any rebuild.

### Recovered from the git remote (`deep-pedal-ai/bike-route-ai`)
- Cloned to **`deeppedal/_remote-restore/`** — contains the **serving-app monorepo**
  (`main`) and, on `docs/corpus-pipeline-planning`, the **planning docs**.
- Those docs are now restored into `corpus-pipeline/docs/`: `PLAN.md`,
  `DECISIONS.md`, `BUILD-LOG.md` (planning-era), and ADRs `0001`/`0002`/`0003`/`0004`.

### Protective backup of the reconstructed code
- `deeppedal/_recovered-corpus-pipeline-backup-20260611/` — a copy of the
  reconstructed `corpus-pipeline/` taken immediately after the incident.

---

## What was COMPLETED before the incident (gate-verified against the live DB)

All four were TDD-built, orchestrator-gate-verified on the real corpus, and
committed on `feat/corpus-pipeline` (those commits were local-only and are lost,
but their **output is in the DB** and their **code is mostly reconstructed**):

- **WP0** foundation, config, cache, migration `001` — 15 tests; schema verified.
- **WP1** Phase 1 OSM relations — 125 routes, all invariants; AC#1 met.
- **WP2** Phase 2 NYSDOT + GPX, Valhalla map-match — 2 routes, geom_original rule confirmed.
- **WP3** Phase 3 NYC DOT facilities + scoring — 23,807 facilities, all 127 routes scored.
- **WP4** canon + generation — built & green (116 passed pre-incident) but **reconstructed
  and UNVERIFIED**; never run live.

---

## What is LOST locally / must be rebuilt or restored

Reconstructed code that **runs** needs these (subagent refused to fabricate them —
a wrong guess masquerading as the original is worse than an honest gap):

- **Build:** `pyproject.toml`, `uv.lock` (+ recreate `.venv` via `uv sync`).
- **Modules referenced by restored code but never read in full:**
  `migrations.py`, `clients/arcgis.py`, `clients/socrata.py`,
  `phases/facility_ingest.py`. (`cli.py` and `p2_loose_gpx.py` import these →
  the package won't import until they exist.)
- **Config geojsons:** `config/metro_boundary.geojson`, `config/metro_boundary.README`,
  `config/nyc_coverage.geojson`.
- **WP0–WP3 test files** and **all `tests/fixtures/`** (incl. the 2 captured ORS
  fixtures — re-capturable in ≤2 calls once the key is set).
- The WP0–WP4 **execution entries** of `BUILD-LOG.md` (the planning-era log was
  restored; the per-WP run log was local-only — superseded by this file).

---

## Recovery routes (in recommended order)

0. **Backups are exhausted (verified 2026-06-11).** iCloud has no copy (`~/Documents`
   not synced — "Desktop & Documents Folders" off), Time Machine isn't configured, and
   APFS has no user-data snapshot. Worth a 2-min self-check anyway: <https://www.icloud.com>
   → Drive → **Recently Deleted**; and name → **iCloud Settings → Data Recovery → Restore
   Files**; and Google Drive → **Trash**. Expected empty. Undelete tools (Disk Drill etc.)
   are a low-odds last resort (APFS SSD + TRIM); only worth it if you stop writing to the
   disk and scan from another boot. **Proceed assuming no backup restore.**
1. **The pushed branch is the off-machine copy of the reconstruction** —
   `feat/corpus-pipeline-reconstructed` on `deep-pedal-ai/bike-route-ai`.
2. **Use the remote clone** at `deeppedal/_remote-restore/` for the serving-app
   monorepo + git history.
3. **Rebuild the missing modules.** They're well-specified: the live endpoints/
   field-mappings are documented in `PLAN.md` + this session's subagent reports, the
   schema is in `001_init.sql` (verified exact vs the live DB), and the live DB is the
   oracle to re-verify against. This is the path the orchestrator paused.

## To get the pipeline RUNNING again (if you choose route 3)

1. `git clone https://github.com/deep-pedal-ai/bike-route-ai` (or reuse `_remote-restore`).
2. Drop the reconstructed `corpus-pipeline/` in; keep `.env` + `exports/`.
3. Recreate `pyproject.toml` from the dep list (httpx, tenacity, shapely, pyproj,
   geojson, gpxpy, psycopg[binary], pydantic, pydantic-settings, typer, PyYAML,
   python-dotenv; dev: pytest) → `uv sync`.
4. Rebuild `migrations.py`, `clients/arcgis.py`, `clients/socrata.py`,
   `phases/facility_ingest.py`, the two geojsons (see live endpoints below).
5. `uv run pytest` to re-green WP0–WP3, re-capture the 2 ORS fixtures, re-green WP4.

### Live endpoints / data sources confirmed this session
- **OSM**: Overpass (public) — needs a descriptive `User-Agent` or it 406s.
- **NYSDOT**: `https://gisportalny.dot.ny.gov/hostingny/rest/services/Framework/State_Bike_Routes/FeatureServer/0` (only SBR 9 & 25A clip to metro).
- **Valhalla**: `https://valhalla1.openstreetmap.de` `/trace_attributes`, `costing=bicycle`, `shape_match=map_snap`.
- **NYC DOT facilities**: Socrata dataset **`mzxg-pwib`** (`status='Current'` filter); `facilitycl` I/II/III/L → protected/lane/sharrow/other, `grnwy='Greenway'` → greenway.
- **Coverage polygon**: NYC Borough Boundaries `wh2p-dxnf` (water-included), 5 boroughs unioned.
- **ORS**: `https://api.openrouteservice.org/v2/directions/cycling-regular` — key confirmed live.
- **PLAN typo to fix on rebuild:** ORS `extra_info` value is **`waytype`** (singular), not `waytypes`; `waytypes` returns ORS error 2003.

---

## Process lesson

The orchestrator gave subagents unsandboxed shell access; one `rm -rf` on a typo'd,
case-insensitively-aliased path destroyed the tree. Mitigations for next time:
push WP commits to the remote after each gate (don't keep history local-only);
run destructive subagent steps in a sandbox or worktree; never `rm -rf` an absolute
path that resolves above the project root.
