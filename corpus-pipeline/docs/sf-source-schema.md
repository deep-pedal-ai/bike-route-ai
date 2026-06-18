# SF / Bay Area Data Source Schema

Live-source discovery conducted 2026-06-17 for the SF region (key `sf`). Every
URL below was fetched against the live endpoint and the response inspected before
writing code. Findings supersede the original task brief where they conflict.

---

## Phase 2 — State Designated Bike Routes (Caltrans)

**Status: UNVERIFIED — placeholder only. Phase 2 will log "no features found" on
a live run until this section is updated with a verified layer.**

### Discovery process

The task brief named Caltrans as the P2 data provider (analogous to WSDOT for
Seattle) and pointed at `caltrans-gis.dot.ca.gov/arcgis/rest/services`. All
top-level ArcGIS service folders reachable from that host were explored:

| Folder | Contents | Bike routes? |
|---|---|---|
| `CHhighway` | State highway geometries, SHN_Lines, functional classes | No designated bike layer found |
| `HQstatewide` | HQ-published statewide datasets | No bike layer found |
| `SB1` | Senate Bill 1 transportation investment tracking | No bike layer found |
| `CCBP` | Clean California Beautification Program — litter/beautification data | Not bike routes (name is misleading) |
| (root)  | Miscellaneous services | No bike layer found |

None of the explored folders expose a FeatureServer layer for California's
designated state bicycle routes (the "State Scenic Bikeway System" or equivalent).

**Conclusion:** No usable Caltrans ArcGIS FeatureServer layer was found. The
`SF.arcgis_layer_path` in `region_profile.py` is set to
`"PLACEHOLDER_UNVERIFIED/FeatureServer/0/query"` and will return zero features.
`SF.arcgis_base_url` points to `caltrans-gis.dot.ca.gov`. Phase 2 will log
"no features found" and continue without error.

### How to fix this when a real layer is discovered

1. Fetch `https://caltrans-gis.dot.ca.gov/arcgis/rest/services?f=json` and
   inspect all folder names for a bike-route layer.
2. Alternatively, check
   `https://opendata.dot.ca.gov/datasets` for a "California Designated Bike
   Routes" or "State Scenic Bikeway" GeoJSON/FeatureServer link.
3. Once verified, update **both** `arcgis_base_url` and `arcgis_layer_path` in
   the `SF = RegionProfile(...)` block in `region_profile.py` and remove the
   `PLACEHOLDER_UNVERIFIED` string. Update this doc.

---

## Phase 3 — City/Region Bike Facilities (SFMTA + MTC Bay Trail)

### SFMTA Bikeway Network — PRIMARY (verified live)

**Socrata dataset (original brief): BROKEN**

Dataset ID `s5wt-b6ed` on `data.sfgov.org` returns HTTP 404. This is the same
"broken federated-view" pattern encountered with Seattle/SDOT: the Socrata ID
references an underlying dataset that was removed or restructured, leaving the
API endpoint dead. **Do not use Socrata for SFMTA facilities.**

**ArcGIS FeatureServer (working replacement):**

```
Base URL : https://services.arcgis.com/ONuuV4O5ETfdTBvB/arcgis/rest/services
Layer    : SFMTA_Bikeway_Network/FeatureServer/0/query
```

Live query of the layer (sample: `?f=json&where=1=1&outFields=*&resultRecordCount=5`)
confirmed these fields and distinct values:

| Field | Sample values | Role |
|---|---|---|
| `facility_t` | `BIKE PATH`, `BIKE LANE`, `BIKE ROUTE` | Primary class discriminator |
| `barrier_ty` | `''` (blank), `SAFE-HIT POSTS` | Physical protection marker for BIKE LANE rows |
| `sharrow` | `0`, `1` (numeric) | Shared-lane marking present (BIKE ROUTE rows) |
| `OBJECTID` | integer | Feature ID (used as `facility_id` via `_sdot_facility_id`) |

**Status field:** The SFMTA layer has **no active/retired status column**. All
features are treated as current. `FacilityLayer.status_field` is `None`.
This is an UNVERIFIED assumption — retired lane geometries could be present in
the dataset without a flag.

#### Classification mapping (locked)

Normalizer: `normalize_sfmta_facility_class(props)` in `facility_ingest.py`.

| `facility_t` | `barrier_ty` | `sharrow` | → class | Notes |
|---|---|---|---|---|
| `BIKE PATH` | any | any | `greenway` | Off-street multi-use path |
| `BIKE LANE` | `SAFE-HIT POSTS` | any | `protected` | Physically separated |
| `BIKE LANE` | blank/other | any | `lane` | On-street designated lane |
| `BIKE ROUTE` | any | `1` | `sharrow` | Shared-lane marking |
| `BIKE ROUTE` | any | `0` | `other` | Route signage only [UNVERIFIED] |
| unknown | any | any | `other` | + `was_unknown=True` |

**Judgment call (UNVERIFIED):** `BIKE ROUTE + sharrow=0` → `'other'`. This maps
route-signage-only corridors (no physical bike infrastructure) to the catch-all
class. Reasonable, but not confirmed against SFMTA's own data dictionary. If a
human reviewer determines these should be `'sharrow'` or dropped entirely, update
`normalize_sfmta_facility_class` and re-run Phase 3.

#### Attribution

```
SFMTA Bikeway Network (San Francisco Municipal Transportation Agency, ArcGIS)
```

---

### MTC Bay Trail — DEFERRED

**Status: DEFERRED — requires a code extension before this source can be ingested.**

**Verified endpoint (live 2026-06-17):**

```
Base URL : https://services3.arcgis.com/i2dkYWmb4wHvYPda/arcgis/rest/services
Layer    : (Bay Trail FeatureServer — layer path TBD, inspect /services?f=json)
Filter   : status='Existing' (active trail segments only)
Class    : all features → 'greenway' (off-street multi-use path)
```

**Why deferred:** `FacilitySource.base_url` is a single string concatenated with
`FacilityLayer.layer_path`. SFMTA uses `services.arcgis.com/ONuuV4O5ETfdTBvB`
and Bay Trail uses `services3.arcgis.com/i2dkYWmb4wHvYPda` — two different ArcGIS
organization hosts. Incorporating both in one `FacilitySource` requires one of:

- Add an optional per-layer `base_url` override to `FacilityLayer` (smallest
  change; recommended).
- Promote `base_url` out of `FacilitySource` and into each `FacilityLayer`
  (larger refactor; more consistent for future multi-host regions).

Until that extension lands, Phase 3 for `sf` ingests SFMTA data only. Bay Trail
coverage is substantial (500+ miles) but geographically non-overlapping with SFMTA
city data; the facility score for Bay-Trail-corridor routes will be
under-counted until Bay Trail is ingested.

---

## Facility coverage area (sf_coverage.geojson)

The SFMTA Bikeway Network covers **SF city proper only** (roughly lat 37.70–37.84,
lon -122.52–-122.35). Routes that extend outside SF (e.g. Iron Horse Trail,
Sausalito paths, Peninsula rides) have only their in-SF-city portion scored for
facility proximity. Phase 3 normalizes the raw proximity score by
`facility_coverage_fraction` (the fraction of the route's length inside the
coverage polygon) so out-of-city route segments are not penalized.

`sf_coverage.geojson` is a DRAFT rectangle approximating this extent. It should
be refined to match the true SFMTA data extent (or the Bay Trail extent once that
source is ingested) before a production scoring run.

---

## Boundary and seed points (sf_boundary.geojson, generation_seed_points)

`sf_boundary.geojson` is a coarse nine-county Bay Area polygon (DRAFT) in
RFC 7946 `[lon, lat]` order. It covers:

- SF city, Marin (Point Reyes → Mill Valley/Sausalito)
- East Bay (Richmond → Fremont/Newark)
- Peninsula (Pacifica → San Jose south)
- South Bay (Cupertino / San Jose)

The 12 seed points for Phase 4 generation are:

| Seed | lon, lat | Area |
|---|---|---|
| Golden Gate Park | -122.4862, 37.7694 | SF |
| Presidio | -122.4716, 37.7996 | SF |
| Sausalito ferry | -122.4852, 37.8590 | Marin |
| Mill Valley / Tam | -122.5457, 37.9060 | Marin |
| Berkeley Marina | -122.3027, 37.8654 | East Bay |
| Lake Merritt / Oakland | -122.2588, 37.8044 | East Bay |
| Iron Horse midpoint, Danville | -121.9998, 37.8219 | East Bay |
| Coyote Hills, Fremont | -122.0574, 37.5577 | East Bay |
| Sawyer Camp Trail, San Mateo | -122.3976, 37.5705 | Peninsula |
| Foster City / Bay Trail | -122.2614, 37.5631 | Peninsula |
| Stevens Creek Trail, Cupertino | -122.0449, 37.3239 | South Bay |
| Coyote Creek Trail, San Jose | -121.8863, 37.3382 | South Bay |

All seed points are in `[lon, lat]` order (stored directly in `RegionProfile`;
NOT subject to the `latlon_to_lonlat` swap — those are already in lon-first order).

---

## Open questions / follow-up (flagged for human review)

1. **Caltrans layer**: Is there a published ArcGIS FeatureServer for California's
   state designated bicycle routes? Check `opendata.dot.ca.gov` and
   `caltrans-gis.dot.ca.gov` for a "Scenic Bikeway" or "State Bike Route" layer.

2. **SFMTA status field**: Confirm (or deny) whether any SFMTA Bikeway Network
   features represent removed/retired lanes that should be filtered out.

3. **Bay Trail deferred source**: Implement per-layer `base_url` override in
   `FacilityLayer` (or equivalent) and add Bay Trail as a second layer in
   `SF.facility_source.layers`. Update `sf_coverage.geojson` to include the
   Bay Trail's geographic extent.

4. **DRAFT coordinates**: All coordinates in `sf_boundary.geojson`, `sf_coverage.geojson`,
   and `sf_canon.yaml` are DRAFT approximations. A human should verify against
   satellite imagery / OSM data before a production pipeline run.
