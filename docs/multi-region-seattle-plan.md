# Multi-Region Corpus — Adding Seattle (Plan)

**Status:** approved direction, not yet implemented.
**Goal:** make the corpus + serving app **region-scoped** so a second metro (Seattle /
Puget Sound) can be ingested through the *same* pipeline and surfaced in the *same* UI,
with the same data richness (quality scores, descriptions, embeddings, POIs) the NY
corpus already has. The mechanism generalizes to an Nth region; Seattle is the first
proof.

This is the cross-package companion to `corpus-pipeline/docs/PLAN.md` (which built the
NY corpus). Read that first for the phase model and the locked ADRs — this plan does not
relitigate them; it parameterizes them by region.

---

## 0. The load-bearing reframe (read this first)

Region is **not cosmetic chrome** — it is the new read partition key. Today the serving
app loads the *entire* corpus in one shot and fits the camera to all of it
(`packages/client/src/pages/MapExplorer.tsx` → `useCorpusRoutes()` with no args →
`viewFromRoutes` → `fitBoundsFromFeatures`), and semantic search ranks a query against
*every* embedding in the table. With two metros ~2,400 mi apart that breaks three ways:

1. **Camera** — "fit to all routes" spans NY→Seattle, opening the map zoomed out to the
   whole continent.
2. **Search** — a NY query ("flat waterfront loop") would rank Seattle's Alki Trail
   against Central Park, because embeddings are global and the corpus *forbids
   mixed embedding models* (so the vectors are directly, wrongly, comparable).
3. **Payload** — the client downloads both metros' geometry to show one.

Therefore `region` must scope: the routes query, the initial camera, the facility bbox,
**and the vector-search SQL** (`WHERE region = $region`). Every decision below follows
from this.

---

## 1. Data sources for Seattle (verified 2026-06-16)

Popularity caveat — the project bans Strava / Komoot / RideWithGPS (PLAN §2, README ODbL
section), and those are the only sources carrying real ridership data. So **"most popular
routes" is a proxy**, assembled exactly as NY's was: OSM-curated relations + government-
designated routes + hand-curated canon. The one license-compatible *popularity* signal is
SDOT/WSDOT **bike/ped counter** data — but those are point counts, so they can **weight /
rank** routes, not **source** them. Treat as a future scoring input, not a data source.

| NY source (phase) | Seattle / WA equivalent | Client reuse |
|---|---|---|
| OSM `route=bicycle` relations (P1, Overpass) | same, with a Seattle `poly:` filter | `overpass.py` unchanged |
| NYSDOT State Bike Routes (P2, ArcGIS @ gisportalny.dot.ny.gov) | **WSDOT** designated routes — `Shared/ActiveTransportationData/FeatureServer/**8**` (Approved US Bike Routes in WA) @ **data.wsdot.wa.gov/arcgis/rest/services**; richer facility inventory in `BikeFacilitiesOnStateRoutes/0` + `BikePathsAlongStateRoutes/0` | `arcgis.py` reused; swap `base_url` + the hardcoded `LAYER_PATH` |
| NYC DOT facilities (P3, Socrata `mzxg-pwib` @ data.cityofnewyork.us) | **SDOT Bike Facilities** — ArcGIS `services.arcgis.com/ZOyb2t4B0UYuYNYH/.../SDOT_Bike_Facilities/FeatureServer`, **layer 2 = Existing** (layer 1 = Multi-use Trails) | ⚠ **`arcgis.py`, NOT `socrata.py`** — the data.seattle.gov Socrata ids `y6ch-r2te`/`cffr-vg49` are non-tabular *federated views* whose `.geojson` export errors out. See §2 + `seattle-source-schema.md`. |
| Canon marquee rides (P4) | hand-authored `seattle_canon.yaml` (Burke-Gilman, Alki, Elliott Bay/Myrtle Edwards, Lake WA Loop, Mercer Island Loop, Seward Park, Green Lake, Sammamish River Trail, Chief Sealth, Interurban) | data entry, not code |
| Generated loops (P4, ORS) | same, Seattle seed points | `ors.py` unchanged |
| (optional) regional trails | **King County GIS** open data | another ArcGIS source |

---

## 2. Pipeline changes — the `RegionProfile` abstraction

Bundle everything region-specific into one object, threaded through clients + phases.
Today these values are scattered as module constants and hardcoded config:

```
RegionProfile:
  key:                 "ny" | "seattle"           # the region column value
  boundary_geojson:    config/<region>_boundary.geojson   # [lon,lat] clip polygon
  bounds_guard:        (lat_min,lat_max,lon_min,lon_max)   # metro.py constants
  projected_crs:       "EPSG:32618" | "EPSG:32610"         # ⚠ see §3
  canon_file:          config/<region>_canon.yaml
  generation_seeds:    [(lon,lat), ...]                    # p4 GENERATION_SEED_POINTS
  coverage_geojson:    config/<region>_coverage.geojson    # facility-coverage polygon
  sources:             per-source { base_url, dataset/layer, facility_class_map }
```

### Config-only changes (no logic)
- **`metro.py`** — the bounds-guard box is hardcoded `lat 40–42 / lon −75…−73`. Seattle is
  **~lat 47–48 / lon −122…−123**. Becomes per-region.
- **`config/<region>_boundary.geojson`** — new Puget Sound clip polygon (`[lon,lat]`).
- **`p4` `GENERATION_SEED_POINTS`** — 12 hardcoded NY `(lon,lat)` seeds → per-region.
- **Source URLs / dataset ids** — already env vars in `config/settings.py`
  (`socrata_base_url`, `arcgis_base_url`, …); the ArcGIS `LAYER_PATH` is a module constant
  in `clients/arcgis.py` and must become configurable.
- **`config/<region>_canon.yaml`** + facility-coverage polygon.

### The one genuine *code* change — the facility classifier
`phases/facility_ingest.py` hard-maps NYC's `facilitycl` codes `I/II/III` + `grnwy` into
`{protected, lane, sharrow, greenway, other}`. SDOT's schema differs — **verified live**
(see `seattle-source-schema.md`): the class field is **`CATEGORY`** with values
`BKF-PBL` (protected), `BKF-BBL` (buffered), `BKF-BL` (painted), `BKF-SHW` (sharrow),
`BKF-NGW` (neighborhood greenway), `BKF-OFFST` (misc off-street), `BKF-CLMB` (climbing),
`<Null>`; the existing-vs-retired filter is **`CURRENT_STATUS='INSVC'`** (the
`status='Current'` analog). Write the per-region mapping explicitly; unknown → `other` +
logged warning.

**Two mapping calls that need a human decision (do not auto-resolve):**
- **`BKF-NGW` Neighborhood Greenway** is an on-street *calmed street*, NOT an off-street
  separated path like NYC's greenway. Mapping it to `greenway` would over-credit it in the
  protected/greenway score weights. Likely belongs in `lane` or a new class.
- **Off-street** (`BKF-OFFST` + the Multi-use Trails layer) → `protected` vs `greenway`
  needs one uniform rule.

---

## 3. ⚠ Highest-risk item: the projected CRS

`geometry.py` hardcodes `PROJECTED_CRS = "EPSG:32618"` (UTM 18N) and caches the
transformers at **module level**. *Every* metric threshold runs in that projection: the
25 m dedup buffer, the <3 km reject, the length-ratio gate, the 15 m facility-proximity
test, length-in-km. Seattle is six UTM zones west and needs **EPSG:32610 (UTM 10N)**.

Using 18N for Seattle geometry **throws no error** — it silently distorts every distance,
which corrupts dedup, scoring, and the length gates. Treat as a correctness gate, not a
constant swap. Because the transformers are module-level singletons, the CRS must be
**threaded through per-region** (or the cache keyed by CRS), not edited in one place.

---

## 4. Data richness & embeddings — free by design

Phase 3 (scoring), Phase 5 (descriptions + embeddings), Phase 6 (POIs) are **fully
region-agnostic** — grep of `p5_embeddings.py`, `description.py`, `embedder.py` shows zero
NYC/borough/coordinate strings. Once Seattle rows land in `routes`, they get the same
`quality_score`, the same description template, the same `text-embedding-3-small` /
1536-dim embeddings, and the same POIs automatically.

Invariant to respect: the pipeline forbids **mixed-model corpora**
(`MixedEmbeddingModelError`, enforced globally in `p5`). Seattle must embed with the same
model NY used. Since the model is hardcoded, this happens for free — and the guard will
*catch* any drift.

---

## 5. Schema change — the `region` column

`routes` distinguishes rows only by `(source, source_id)` today; there is no region/city
column (`db/migrations/001_init.sql`). Add a new pipeline migration:

- `routes` + `facility_segments` get `region text NOT NULL`.
- Unique key `(source, source_id)` → **`(region, source, source_id)`** (OSM relation ids
  are globally unique, but canon slugs / generated ids can collide across regions).
- Cross-region dedup is *geometrically* harmless (bboxes a continent apart never overlap),
  so the column is about **serving + per-region stats**, not dedup correctness.

DDL is owned by the pipeline; the serving app only mirrors it read-side.

---

## 6. Serving-app changes

- **`packages/shared/src/corpus.ts`** — add `region` to `CorpusRouteProps`
  (types-only package; this is a frozen contract → re-freeze + dependent notice).
- **`packages/server/src/db/schema.ts`** — read-mirror gets `region`.
- **Routes API** — `getRoutesOverview(region)` on the `CorpusClient` seam
  (`services/corpus-service.ts`), `GET /api/corpus/routes?region=<key>`.
- **Facilities** — already bbox-scoped; bbox implies region, but pass `region` for
  correctness on bbox edges.
- **Semantic search** — add `WHERE region = $region` to the vector-similarity query.
  *(Locate the exact file: the `<=>`/embedding query under
  `packages/server/src/services/` or `clients/corpus-client.ts` — Bash was unavailable at
  write time; confirm before editing.)* Without this, a NY query ranks Seattle routes.

---

## 7. Frontend — the region switcher

**Decisions locked (2026-06-16):**
- **Switch behavior: pill jump + soft suggest.** A `RegionSwitcher` segmented control,
  **top-left**, distinct from the centered search bar (search stays uncluttered; it floats
  top-center at z-40 today). Clicking a pill **flies the camera there *and* swaps the
  loaded corpus** — the same gesture as clicking a result to zoom to a route. If the
  viewport comes to **rest** centered over another region's bbox, show a small dismissible
  nudge (`Viewing Seattle · Switch?`). **Never** swap silently mid-pan.
- **First-visit default: geolocate-nearest, NY fallback.** On first load with no
  `?region` in the URL, pick the nearest region (browser geolocation or IP); fall back to
  NY on denial/failure.
- **Persistence: URL.** `?region=seattle` alongside the existing `?route=<id>`
  (`useSearchParams`), so links deep-link to a metro.

Build `RegionSwitcher` against a **region list**, not two hardcoded buttons — a 3rd region
should degrade into a dropdown, not a redesign.

Client wiring:
- `useCorpusRoutes(region)` — scope the query.
- Replace hardcoded `NY_DEFAULT` + fit-to-all with a **per-region** initial camera
  (region default center+zoom, or fit-to-region-bounds).
- Region-scope the facility bbox (currently a hardcoded NY-wide box in `MapExplorer`).
- Pass `region` to the search hook so results stay in-metro.

---

## 8. Suggested sequencing (vertical slices)

1. **Schema + region plumbing (no Seattle data yet):** ✅ **DONE** — branch
   `feat/multi-region-seattle` (uncommitted). Migration `003_region.sql`, NY backfill,
   `region` threaded shared → server → client, `RegionSwitcher` (NY only; Seattle entry
   `enabled: false`). Both gates green (`uv run pytest`, `npm run ci`). **Blocker for the
   DB-backed test suites:** the shared Neon `TEST_DATABASE_URL` branch must have 003 applied
   (orchestrator-owned per PLAN §9) before `corpus.test.ts` / `corpus-client.test.ts` /
   `schema-drift.test.ts` run against it.
2. **`RegionProfile` refactor in the pipeline:** parameterize boundary, bounds, **CRS**,
   canon, seeds, coverage, source config — re-run NY through it, byte-compare the corpus to
   prove the refactor is behavior-preserving. (Replaces the per-phase `REGION='ny'` literals
   Slice 1 introduced.)
3. **Seattle sources:** Overpass polygon; WSDOT ArcGIS (`ActiveTransportationData/8`); SDOT
   facilities **via `arcgis.py`** (layer 2, `CATEGORY`/`CURRENT_STATUS='INSVC'`) + the
   facility-class mapping (resolve the two flagged calls in §2); Seattle canon + seeds. Run
   P1–P6 with `region='seattle'`.
4. **Frontend polish:** geolocate default, soft-suggest nudge, per-region camera. Flip the
   Seattle entry to `enabled: true` in `regions.ts`.

Gate each slice the way `PLAN.md` does: tests green, the relevant rows present with scores
*and embeddings*, `git diff` scoped to the intended packages.

---

## 9. Open risks / to-confirm

- **CRS threading (§3)** — the single highest-risk change; verify metric math against
  hand-computed Seattle fixtures.
- **SDOT facility schema** — ✅ resolved (`seattle-source-schema.md`): ArcGIS not Socrata,
  field `CATEGORY`, filter `CURRENT_STATUS='INSVC'`. Remaining: the two mapping calls in §2.
- **WSDOT layer path** — ✅ resolved: `ActiveTransportationData/FeatureServer/8` for
  designated US Bike Routes; facility inventory in `BikeFacilitiesOnStateRoutes/0` +
  `BikePathsAlongStateRoutes/0`. WSDOT permanent-counter dataset UNVERIFIED (see schema doc).
- **Search SQL location** — ✅ resolved: `clients/db-client.ts` (`findNearestRoutes`); Slice
  1 threads `region` as a separate param so the no-results relax path keeps the partition.
- **Shared contract re-freeze** — `corpus.ts` is marked frozen; adding `region` needs the
  documented re-freeze + dependent-notice step.
