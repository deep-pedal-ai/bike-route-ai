# Freewheel Corpus Pipeline

A Python + PostGIS ETL pipeline that assembles a corpus of NYC-metro cycling
routes from open data — OSM bicycle relations, NYSDOT state bike routes, NYC DOT
bike facilities, hand-curated "canon" rides, and machine-generated loops — scores
each route for quality, deduplicates across sources, and writes everything into a
single `routes` table that the Freewheel serving app reads.

This package lives **outside** the serving-app monorepo's `packages/` glob and
shares **only the database** with it (ADR-0001). It manages its own Python
toolchain (uv, Python 3.12) and never imports or is imported by the TS app.

---

## Setup

Requires **Python 3.12** and **[uv](https://docs.astral.sh/uv/)**, plus a
**PostGIS-capable Postgres** (16+ / PostGIS 3.4+; the build ran on PG 17 /
PostGIS 3.5). See [`docs/infrastructure.md`](docs/infrastructure.md) for the DB
handoff spec.

```bash
cd corpus-pipeline
uv sync                 # create .venv + install deps from pyproject/uv.lock
cp .env.example .env    # then fill in the values below (.env is gitignored)
uv run pytest           # run the test suite (DB tests skip if TEST_DATABASE_URL unset)
```

The CLI entry point is `uv run freewheel-corpus <command>`.

---

## Environment variables (`.env`)

| Var | Required | Purpose |
|-----|----------|---------|
| `DATABASE_URL` | **yes** | The corpus DB (`postgresql://…?sslmode=require`). Sole integration seam with the serving app. |
| `ORS_API_KEY` | **yes** for Phase 4 | openrouteservice key (canon routing + loop generation). Unit tests use fixtures and need no key. |
| `OPENAI_API_KEY` | **yes** for Phase 5 | OpenAI key for `text-embedding-3-small` route description embeddings. |
| `TEST_DATABASE_URL` | no | Isolated test branch for DB-backed tests + the Phase-1 integration test. Tests skip cleanly when unset; **never** `DATABASE_URL`. |
| `OVERPASS_BASE_URL`, `VALHALLA_BASE_URL`, `ORS_BASE_URL`, `SOCRATA_BASE_URL`, `ARCGIS_BASE_URL` | no | Per-service base URLs, each defaulting to the public endpoint (override to self-host later). |

Scoring weights, source priors, and gate thresholds are also env-overridable —
see [`config/settings.py`](src/freewheel_corpus/config/settings.py); the defaults
are the documented v1 heuristic.

---

## Run order

The canonical end-to-end sequence (the orchestrated pipeline):

```bash
uv run freewheel-corpus migrate    # apply migration 001 (idempotent)
uv run freewheel-corpus phase1     # OSM route=bicycle relations  (Overpass)
uv run freewheel-corpus phase2     # NYSDOT + manual GPX, map-matched (ArcGIS + Valhalla)
uv run freewheel-corpus phase3     # NYC DOT facilities + quality scoring (Socrata)
uv run freewheel-corpus phase4     # canon seeding + scored loop generation (ORS)
uv run freewheel-corpus phase3     # FINAL pass: score canon/generated + cross-source dedup
uv run freewheel-corpus phase5     # descriptions + embeddings for semantic search
uv run freewheel-corpus stats      # counts by source, score distribution, rejected/unmatched
```

**Why `phase3` runs twice.** The first `phase3` ingests facilities and scores the
routes that exist before Phase 4. The **final** `phase3` (a) scores the canon and
generated rows that Phase 4 just ingested with NULL `quality_score`, and (b) runs
the **full-table cross-source dedup pass** (ADR-0003): when a marquee ride exists
both as an OSM relation and a curated canon entry, the lower-precedence twin is
**hard-deleted** and both IDs are logged to `ingest_log` as `skipped_duplicate`.
The final `phase3` is idempotent — re-running it scores in place and finds no
remaining duplicates, so it is safe to repeat.

Precedence ladder (ADR-0003):
`canon > osm_relation > nysdot > usbrs > open_gpx > generated`.

Every external HTTP response is disk-cached under `data/raw/{client}/` (gitignored),
so a quota-exhausted or interrupted run resumes nearly free; `--no-cache` busts it.

---

## The canon-verification workflow (human-gated)

`config/canon.yaml` holds the marquee rides as **DRAFT** human `[lat, lon]`
coordinates (note: YAML is `[lat, lon]`; code swaps to `[lon, lat]` in exactly one
guarded helper, Q5). Because the draft coordinates are unverified, the first
`phase4 --canon-only` run is **expected** to skip several entries whose routed
distance lands more than ±25% off the entry's `expected_km`:

1. Run `phase4 --canon-only`. Entries that route too long/short are **logged**
   (`ingest_log` event `canon_skip_distance` / `canon_skip_coord`) and **skipped**,
   not stored. This is normal — not a failure (PLAN §11).
2. A **human** reviews the skipped entries, opens `canon.yaml`, and corrects the
   draft `[lat, lon]` waypoints (e.g. snap a start point onto the greenway, fix a
   transposed coordinate). **Coordinates are never auto-corrected** — a wrong guess
   masquerading as a verified coordinate is worse than an honest skip.
3. Re-run `phase4 --canon-only`. The disk cache replays the good entries for free;
   only the corrected ones re-route. Repeat until the skip log is empty.

The metro-bounds guard (lat 40–42 / lon −75…−73) makes a transposed coordinate
fail loudly rather than silently routing into the ocean.

---

## Considered alternatives — `osm-api-js`

We evaluated `osmlab/osm-api-js` for OSM access and **rejected** it (ADR-0001).
It wraps the OSM **v0.6 editing API** — element CRUD, changesets, OAuth — which is
for *modifying* OSM, not bulk spatial querying. Our OSM access is **Overpass** bulk
queries (a single HTTP POST returning all `route=bicycle` relations in the metro
polygon), which needs no client library. More broadly, this pipeline is
geometry-heavy ETL where the Python geo stack (`shapely`, `pyproj`, `gpxpy`) is
materially stronger than the JS equivalents, and it shares only the database with
the TS serving app, so a Python toolchain costs nothing at runtime. Porting to JS
later would be a deliberate single-toolchain rewrite, not an incidental one.

---

## ODbL attribution obligations (important)

OpenStreetMap data — which underpins the OSM relations, the Valhalla/ORS routing,
and every generated loop — is licensed under the **Open Database License (ODbL
1.0)**. Two obligations flow from this and **must** be honoured downstream:

1. **Attribution must surface in any UI.** Every route stores its `attribution`
   string (e.g. `© OpenStreetMap contributors, ODbL 1.0`, or for routed rides
   `© OpenStreetMap contributors, ODbL; routed via openrouteservice`). Any app or
   export that displays a route **must** show "© OpenStreetMap contributors" and
   reference ODbL — this is a license requirement, not a nicety. The
   `routes.attribution` column carries the exact text to surface per route.
2. **Share-alike applies to the derived database.** The `routes` corpus is a
   **Derivative Database** of OSM under ODbL. If the corpus (or a Produced Work
   that conveys it as data) is publicly distributed, it must be offered under
   ODbL, and any publicly-used adaptations of the database must be shared back
   under the same terms. Keep the corpus's provenance and license clear if it is
   ever published or shared outside the team. (Government open-data sources —
   NYSDOT, NYC DOT — and ORS routing on OSM are compatible with this; no
   Strava/Komoot/RideWithGPS data is used anywhere, by design.)

---

## Reference docs

- [`docs/infrastructure.md`](docs/infrastructure.md) — DB handoff spec: engine
  requirements, the `DATABASE_URL` contract + DDL rights, data volume, a
  reference-only PostGIS compose snippet, and the self-hosted routing-graph
  extent note. *(Not implemented here — the pipeline owns no infra.)*
- [`docs/embeddings-plan.md`](docs/embeddings-plan.md) — Phase-5 design:
  description template, the `Embedder` protocol, pgvector columns, and the
  env-gated ranking acceptance test.
- [`docs/PLAN.md`](docs/PLAN.md) / [`docs/DECISIONS.md`](docs/DECISIONS.md) /
  [`docs/adr/`](docs/adr/) — the build plan, locked decisions, and ADRs.
- [`docs/RECOVERY.md`](docs/RECOVERY.md) — incident/handoff record (a local file
  deletion during WP4; the corpus on the DB was never touched).
- [`docs/TEARDOWN.md`](docs/TEARDOWN.md) — how to explore and then tear down the
  Neon database when you are done (it is left **persistent** for exploration, not
  auto-deleted).
