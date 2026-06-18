# Add-a-Region — Agent Prompt

> **What this is:** a ready-to-run prompt for a coding agent (Claude Code) that adds a **new
> region/city** to VeloMindAI — the corpus database + Python pipeline + the serving app/frontend —
> by parameterizing the existing design, not redesigning it.
>
> **How to use:** copy everything in the fenced block below into a fresh Claude Code session at the
> repo root, fill in the two blanks at the top (`REGION_NAME`, `REGION_KEY`), and run it. The agent
> reads the canonical multi-region docs first, does live source-discovery, then works in gated slices.
>
> **Worked example to follow:** New York is region #1; **Seattle** (region #2) is already scaffolded —
> it is the pattern every step mirrors. See [`multi-region-seattle-plan.md`](./multi-region-seattle-plan.md)
> and [`seattle-source-schema.md`](./seattle-source-schema.md).

---

````
# Add a new region to VeloMindAI (corpus DB + pipeline + frontend)

FILL IN:
  REGION_NAME = "<<e.g. San Francisco / Bay Area>>"
  REGION_KEY  = "<<short lowercase slug, e.g. sf>>"   # the `region` column value, CLI selector, ?region= value

You are adding REGION_NAME as a new region so it ingests through the SAME pipeline and
surfaces in the SAME UI as the existing New York corpus, with the same richness (quality
scores, descriptions, embeddings, POIs). New York is region #1; Seattle is region #2 and is
already scaffolded — it is your worked example. Do NOT relitigate any locked decision; you are
PARAMETERIZING the existing design by region, not redesigning it.

═══ STEP 0 — READ THESE FIRST (do not write code until you have) ═══
The "add a region" pattern is already documented. Read, in this order:
  1. docs/multi-region-seattle-plan.md      ← THE canonical add-a-region playbook. Your work mirrors
                                              every section (§1 sources, §2 RegionProfile, §3 CRS,
                                              §5 schema, §6 server, §7 frontend, §8 sequencing).
  2. docs/seattle-source-schema.md          ← the TEMPLATE for the source-discovery doc you must
                                              produce for REGION_NAME (see Step 1). Note its hard
                                              lesson: a Socrata id can be a broken federated view —
                                              always verify the live endpoint, prefer ArcGIS when it is.
  3. corpus-pipeline/docs/PLAN.md           ← the phase model (migrate → P1…P6 → stats) + the locked ADRs.
  4. corpus-pipeline/docs/DECISIONS.md and corpus-pipeline/docs/adr/  ← especially ADR-0002 (projected
                                              CRS) and ADR-0003 (dedup precedence). Obey them.
  5. corpus-pipeline/README.md              ← run order + the ODbL / licensing constraint (see below).

Then read the code you will extend (the region abstraction already exists — you are adding an entry):
  - corpus-pipeline/src/freewheel_corpus/region_profile.py   (NY + SEATTLE RegionProfile objects; add a third)
  - corpus-pipeline/src/freewheel_corpus/metro.py            (per-region bounds guard)
  - corpus-pipeline/src/freewheel_corpus/geometry.py         (PROJECTED_CRS — the highest-risk item, §3)
  - corpus-pipeline/src/freewheel_corpus/clients/{arcgis,socrata,overpass,ors}.py
  - corpus-pipeline/src/freewheel_corpus/phases/facility_ingest.py  (the facility-class mapping)
  - corpus-pipeline/src/freewheel_corpus/db/migrations/*.sql        (the region column migration)
  - packages/shared/src/corpus.ts          (frozen types — `region` field)
  - packages/server/src/db/schema.ts, services/corpus-service.ts, clients/db-client.ts (region-scoped reads + search)
  - packages/client/src/regions.ts, components/RegionSwitcher.tsx, pages/MapExplorer.tsx

═══ HARD CONSTRAINTS (non-negotiable) ═══
- DATA SOURCES: only OpenStreetMap (ODbL), US/state/city government open data, and routes we
  generate on those. NEVER Strava / Komoot / RideWithGPS. Every route stores its ODbL attribution.
- PROJECTED CRS IS A CORRECTNESS GATE, NOT A CONSTANT SWAP (plan §3). Every metric threshold
  (25 m dedup buffer, <3 km reject, length-ratio gate, 15 m facility proximity, length-in-km) runs
  in the region's UTM zone. Using the wrong zone throws NO error — it silently distorts every metre
  and corrupts dedup + scoring. Determine REGION_NAME's correct UTM zone / EPSG, thread it through
  per-region, and verify the metric math against hand-computed REGION_NAME fixtures.
- BOUNDS GUARD: set a generous lat/lon box for REGION_NAME; it is the transposition tripwire — a
  flipped [lat,lon] coordinate must fail loudly, not query the wrong place.
- SCOPE: pipeline changes stay inside corpus-pipeline/; serving-app changes stay inside packages/.
  Keep git diffs scoped per slice. `corpus.ts` is a frozen contract — adding `region` needs the
  documented re-freeze + dependent-notice step.
- The pipeline forbids mixed-model embeddings; REGION_NAME must embed with the SAME model NY used
  (it's hardcoded, so this is free — but don't change it).

═══ STEP 1 — SOURCE DISCOVERY (do this before coding; it gates everything) ═══
Produce docs/{REGION_KEY}-source-schema.md, mirroring docs/seattle-source-schema.md. For
REGION_NAME, hit each LIVE endpoint and record exact URLs, layer/dataset ids, field names, and
distinct class values for:
  - OSM route=bicycle relations (Overpass) — confirm the metro `poly:` filter.
  - State-designated bike routes (the NYSDOT/WSDOT analog) — find the state DOT ArcGIS (or equivalent).
  - City bike-facility data (the NYC DOT / SDOT analog) — find it, VERIFY the export actually works
    (Socrata vs ArcGIS — repeat the Seattle lesson), and record the class field + its values and the
    current-vs-retired filter.
  - Candidate canon marquee rides (well-known local rides) and ~12 generation seed points.
  - The correct projected CRS / UTM zone and a proposed bounds-guard box.
Tag anything you could not verify as UNVERIFIED. FLAG (don't auto-resolve) any facility-class mapping
that needs a human judgment call — e.g. an on-street "greenway/neighborhood greenway" that must NOT be
scored like an off-street protected path. Stop and surface these for review.

═══ STEP 2 — PIPELINE (corpus-pipeline/) ═══
Following plan §2–§5, add REGION_NAME as a new RegionProfile and supporting config:
  - region_profile.py: a new RegionProfile (key=REGION_KEY) with bounds, boundary_path, projected_crs,
    canon_path, coverage_path, generation_seed_points, arcgis_layer_path/base_url, facility_source +
    its class mapping. Add it to the REGIONS dict. Mirror how SEATTLE is defined.
  - config/{REGION_KEY}_boundary.geojson ([lon,lat] clip polygon), {REGION_KEY}_coverage.geojson
    (facility-coverage polygon), {REGION_KEY}_canon.yaml (hand-authored marquee rides).
  - facility_ingest.py: add REGION_NAME's explicit class mapping → {protected, lane, sharrow, greenway,
    other}; unknown → other + logged warning. Apply the current-only filter you verified.
  - DB migration: ensure `region text NOT NULL` exists on routes + facility_segments and the unique key
    is (region, source, source_id). (NY/Seattle may already have added this — extend, don't duplicate.)
  - Run the full corpus for REGION_KEY: migrate → P1 → P2 → P3 → P4 → P3(final dedup) → P5 → P6 → stats.
  - TDD per PLAN.md: tests green; verify the metric math in the new CRS with hand-computed fixtures.

═══ STEP 3 — SERVING APP + FRONTEND (packages/) ═══
Following plan §6–§7:
  - shared/corpus.ts: `region` on the route props (re-freeze + dependent notice).
  - server: region-scope the routes overview query, the facility bbox, AND the vector-search SQL
    (db-client.ts findNearestRoutes — `WHERE region = $region`, threaded as its own param so the
    no-results relax path keeps the partition). Without this, a REGION_NAME query ranks NY routes.
  - client/regions.ts: add { key: REGION_KEY, label: REGION_NAME, defaultView: {…}, enabled: true }.
  - Per-region initial camera (replace fit-to-all), region-scoped corpus + facilities + search hooks,
    RegionSwitcher already list-driven (a 3rd region degrades into a dropdown, not a redesign).

═══ SEQUENCING & GATES ═══
Work in vertical slices (plan §8): (1) source-schema doc + flagged decisions reviewed → (2) RegionProfile
+ config + facility mapping + migration, corpus built → (3) server + frontend wiring → (4) flip enabled:true.
Gate each slice exactly like PLAN.md: `uv run pytest` green (pipeline), `npm run ci` green (app), the
REGION_KEY rows present WITH scores AND embeddings, and `git diff` scoped to the intended packages.

═══ DELIVERABLES ═══
- docs/{REGION_KEY}-source-schema.md (verified, with UNVERIFIED + human-decision items flagged)
- New RegionProfile + config files + facility mapping + green pipeline run for REGION_KEY
- Region-scoped server reads/search + regions.ts entry (enabled) + region-scoped client
- A short summary of what was built, what's UNVERIFIED, and any flagged mapping decisions awaiting a human.

START by reading the five markdowns above and producing docs/{REGION_KEY}-source-schema.md. Do not write
pipeline or app code until the source schema is verified and the flagged decisions are surfaced.
````

---

## Post-merge review checklist

When the teammate's branch is up, confirm:

- [ ] **`docs/{REGION_KEY}-source-schema.md`** exists, every endpoint was hit live, and `UNVERIFIED` /
      human-decision items are explicitly flagged (mirrors [`seattle-source-schema.md`](./seattle-source-schema.md)).
- [ ] **Projected CRS** is the correct UTM zone for the region and is threaded per-region — verified
      against hand-computed fixtures, not just swapped (see [plan §3](./multi-region-seattle-plan.md)).
- [ ] **Bounds guard** box set for the region (transposition tripwire).
- [ ] **Facility-class mapping** is explicit, current-only filter applied, and any judgment calls were
      surfaced for a human rather than auto-resolved.
- [ ] New **`RegionProfile`** added to the `REGIONS` dict; boundary / coverage / canon / seeds config present.
- [ ] Pipeline ran end-to-end for the region: rows present **with `quality_score` AND embeddings**; same
      embedding model as NY (no `MixedEmbeddingModelError`).
- [ ] Server reads + **vector search are region-scoped** (`WHERE region = …`); facility bbox carries region.
- [ ] **`regions.ts`** entry added and `enabled: true`; per-region initial camera; switcher still list-driven.
- [ ] `uv run pytest` and `npm run ci` both green; `git diff` scoped to the intended packages; `corpus.ts`
      re-freeze step done if the shared contract changed.
