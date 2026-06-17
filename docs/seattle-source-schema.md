# Seattle / Puget Sound — Source Schema Research (verified live 2026-06-16)

Read-only research grounding the multi-region Seattle work (`docs/multi-region-seattle-plan.md`
§1–§3). Every column list, distinct value, and URL below was hit against the **live endpoint**
on 2026-06-16 (see "Endpoints hit" per section). Unverified items are explicitly tagged.

---

## ⚠ HEADLINE FINDING — the plan's "Socrata verbatim" assumption is wrong

`multi-region-seattle-plan.md` §1 says SDOT facilities come from **Socrata** `y6ch-r2te` /
`cffr-vg49` and that `socrata.py` is reused **verbatim**. **That is not how the data is served.**

- `y6ch-r2te` and `cffr-vg49` on `data.seattle.gov` are **`federated_href` views**, not native
  tabular Socrata datasets. The Socrata GeoJSON/JSON export endpoints return errors:
  - `…/resource/y6ch-r2te.geojson?$limit=5` → `{"error":true,"message":"GeoJSON/SoQLPack MimeType is only supported for new backend views."}`
  - `…/resource/y6ch-r2te.json?$limit=2` → `{"error":true,"message":"no row or column access to non-tabular tables"}`
- Their `metadata.additionalAccessPoints` point at SDOT's **ArcGIS Online FeatureServer**:
  `https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Bike_Facilities/FeatureServer`
- A catalog search (`data.seattle.gov/api/catalog/v1?q=bike facilities`) returns several
  `dataset`-typed bike-facility IDs (`9aey-9g9p`, `5hpa-8dfv`, `hfw2-4nct`), but probing each
  `…/resource/<id>.geojson` returns `{"error":true,"message":"Not found"}` — they are catalog
  artifacts, not queryable tabular backends.

**Consequence:** SDOT bike facilities (Phase 3) must be ingested through **`arcgis.py`, not
`socrata.py`.** This is good news for reuse: the existing `ArcGISClient` works almost verbatim
(see below — SDOT's GeoJSON export already sets `properties.exceededTransferLimit`, the exact flag
`fetch_all_features` checks). It is bad news for the plan's source table, which should be corrected
to "SDOT via ArcGIS FeatureServer" rather than "Socrata `socrata.py` verbatim".

---

## 1. SDOT Bike Facilities — ArcGIS FeatureServer (Phase 3, facility_segments)

**Service (one FeatureServer holds all three SDOT bike layers):**
```
https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Bike_Facilities/FeatureServer
```
`maxRecordCount = 2000`, `supportsPagination = true`.

| Layer idx | Name | Geometry | Role |
|---|---|---|---|
| 1 | Multi-use Trails (Seattle Only) | esriGeometryPolyline | the `cffr-vg49` analog (off-street trails) |
| **2** | **Existing Bike Facilities** | esriGeometryPolyline | **the `y6ch-r2te` analog — the classifier source** |
| 3 | Planned Bike Facilities | esriGeometryPolyline | future facilities (skip for current corpus) |

### Layer 2 (Existing Bike Facilities) — the NYC `facilitycl` analog

**Classification field:** `CATEGORY` (string). **Status field:** `CURRENT_STATUS` (string).
Facility id analog (NYC `segmentid`): `COMPKEY` (integer) or `OBJECTID`.

**`CATEGORY` distinct values + decoded labels** (labels are authoritative, pulled from the layer's
`drawingInfo.renderer.uniqueValueInfos`) and **counts** (all rows / `CURRENT_STATUS='INSVC'` only):

| `CATEGORY` code | Decoded label (renderer) | count (all) | count (INSVC) |
|---|---|---|---|
| `BKF-PBL` | Protected Bike Lanes | 690 | 618 |
| `BKF-BBL` | Buffered Bike Lanes | 29 | 29 |
| `BKF-BL` | Painted Bike Lanes | 935 | 666 |
| `BKF-CLMB` | Climbing Lanes | 8 | 5 |
| `BKF-SHW` | Sharrows | 1048 | 646 |
| `BKF-NGW` | Neighborhood Greenways | 875 | 857 |
| `BKF-OFFST` | Miscellaneous Off Street Bicycle Facility | 40 | 40 |
| `None` / `<Null>` | Unidentified | 11 | 3 |

**`CURRENT_STATUS` distinct values:** `'INSVC'` (in service), `'UNDERCONS'` (under construction),
`'PLNRECON'` (planned/reconstruction). → The current-status filter analog to NYC's
`status='Current'` is **`CURRENT_STATUS = 'INSVC'`**. Note: layer 2 ("Existing") still contains
UNDERCONS/PLNRECON rows, so the `INSVC` filter is needed *in addition to* using layer 2.

`STYLE` (separation material, only populated for separated facilities) distinct values:
`None`, `BKF-DELPST` (delineator post), `BKF-CONBAR` (concrete barrier), `BKF-LSCP` (landscape),
`BKF-CONCRB` (concrete curb), `BKF-TRPV` — useful as a future refinement signal but **not** needed
for the 5-class mapping.

No coded-value `domain` is shipped on `CATEGORY`/`STYLE`/`CURRENT_STATUS` (bare strings); decode
via the labels above.

**Full layer-2 field list** (verified): `OBJECTID, COMPKEY, COMPTYPE, SEGKEY, UNITID, UNITTYPE,
UNITDESC, CATEGORY, MATERIAL, STYLE, MODEL_TYPE, ASSET_WIDTH, ASSET_HEIGHT, INSTALL_DATE, ASBLT,
ATTACHMENT_1..10, NUM_ATTACHMENTS, COMMENTS, CURRENT_STATUS, CURRENT_STATUS_DATE, CONDITION,
CONDITION_ASSESSMENT_DATE, LAST_ASSET_VERIFICATION_DATE, PRIMARYDISTRICTCD, SECONDARYDISTRICTCD,
OVERRIDEYN, OVERRIDECOMMENT, OWNERSHIP, OWNERSHIP_DATE, MAINTAINED_BY, MAINTENANCE_AGREEMENT,
MAINTENANCE_FINANCIAL_RESP, ADDBY, ADDDTTM, MODBY, MODDTTM, DATE_MVW_LAST_UPDATED, COLOR,
MOUNT_TYPE, MOUNT_MATERIAL, EXPBY, EXPDATE, MAINT_GRP_PAINT/PLANTS/POST/SNOW/SWEEP, Shape__Length`.
There is **no `boro`/borough analog** — `PRIMARYDISTRICTCD` (City Council district) is the closest;
the NYC `_BOROUGH_MAP` step has no equivalent and the `borough` column should be left NULL for
Seattle (or repurposed as district, a separate decision).

### Layer 1 (Multi-use Trails) — the `cffr-vg49` analog

Geometry esriGeometryPolyline. **It is a street-network centerline extract, not a classified
facility layer** — its fields are SND (Seattle street-network) attributes: `SND_FEACODE,
SEGMENT_TYPE, ACCESS_CODE, DIVIDED_CODE, STRUCTURE_TYPE, VEHICLE_USE_CODE, ORD_STNAME_CONCAT,
L_CITY/R_CITY, COMPKEY, COMPTYPE, UNITID, …`. **There is no facility-class field here** — every
feature is, by definition of the layer, an off-street multi-use trail. So all layer-1 features map
to a single class (see mapping note on `greenway` vs `protected` below). No `CURRENT_STATUS` field
on layer 1 (no server-side status filter available there).

### Exact query URL pattern (use `arcgis.py` `ArcGISClient`, swap `LAYER_PATH`)

```
https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/SDOT_Bike_Facilities/FeatureServer/2/query
  ?where=CURRENT_STATUS%3D%27INSVC%27        # or where=1%3D1 + belt-and-suspenders filter in code
  &outFields=*
  &f=geojson
  &outSR=4326
  &resultOffset=0&resultRecordCount=2000
```
**Pagination verified:** a `f=geojson` page returns `properties.exceededTransferLimit: true` when
more pages remain (top-level `exceededTransferLimit` is `null` on this server). `arcgis.py`
`fetch_all_features` already checks `(payload.get("properties") or {}).get("exceededTransferLimit")`
→ **works unchanged.** Sample geometry returned is `LineString` (promote to MultiLineString in
`facility_ingest`, exactly as NYC does).

**RegionProfile source config (proposed):**
```
sources.sdot_facilities:
  base_url:   https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services
  layer_path: SDOT_Bike_Facilities/FeatureServer/2/query    # Existing Bike Facilities
  where:      CURRENT_STATUS='INSVC'
  facility_class_field: CATEGORY
  facility_class_map:   <see §3>
sources.sdot_trails:
  layer_path: SDOT_Bike_Facilities/FeatureServer/1/query    # Multi-use Trails; all -> greenway (see §3 caveat)
```

**Endpoints hit:** `…/api/views/y6ch-r2te.json`, `…/api/views/cffr-vg49.json`,
`…/resource/y6ch-r2te.{geojson,json}`, `…/SDOT_Bike_Facilities/FeatureServer?f=json`,
`…/FeatureServer/{1,2}?f=json`, `…/FeatureServer/2/query` (distinct, groupBy stats, geojson page,
renderer legend), `…/api/catalog/v1?q=bike facilities`.

---

## 2. WSDOT — state-route bike data (Phase 2, route source — NOT facility_segments)

Host (matches plan): `https://data.wsdot.wa.gov/arcgis/rest/services`. WSDOT is the **NYSDOT State
Bike Routes analog → Phase 2** (designated/state-route geometry assembled + matched to OSM). **It
therefore needs NO facility_class map** — that mapping is SDOT/Phase-3 only. Keep that framing clean.

Three relevant polyline layers exist; they serve **different purposes** — present all three, the
plan should pick deliberately:

| Service / layer | Name | count | maxRecordCount | Role |
|---|---|---|---|---|
| `Shared/BikeFacilitiesOnStateRoutes/FeatureServer/0` | Bike Facilities On State Routes | **418** | 2000 | facility *inventory* on state routes (rich attrs; `BikeFacilityType`, `Status`, `USBikeRoute`) |
| `Shared/BikePathsAlongStateRoutes/FeatureServer/0` | Bike Paths Along State Routes | **392** | 2000 | off-street paths *alongside* state routes (`CyclewayType`, `SurfaceType`, `Status`) |
| `Shared/ActiveTransportationData/FeatureServer/8` | Approved US Bike Routes | **103** | 1000 | AASHTO-designated **US Bike Routes** in WA (long designated routes) |

`ActiveTransportationData/FeatureServer` sub-layers (full index for reference): 0 State Route
Permanent Bike Restrictions, 1 Population Centers (poly), 2 LTS, 3/4/5 Route Directness Index
(pt/route/transect), **6 Bike Facilities**, 7 Sandy Williams Equity Needs (poly), **8 Approved US
Bike Routes**, 9 VRUCI (poly).

**Recommendation / discriminator:** the NYSDOT P2 source is *designated route geometry*. The closest
analog is **`ActiveTransportationData/FeatureServer/8` (Approved US Bike Routes, 103 features —
sparse, route-shaped, has `BikeRouteName`/`BikeRouteNumber`/`BikeRouteType`)**. The two
`*StateRoutes` layers (418 / 392) are facility/path *inventory* keyed by route-mile
(`BeginStateRouteMilepost`, `RouteIdentifier`) — denser, segment-shaped; usable as a *supplementary*
facility signal but they are not "designated routes." All three are well under one
2000-record page, so pagination is a non-issue regardless of choice.

### Layer field lists (verified)

**`BikeFacilitiesOnStateRoutes/0`** (`supportsPagination=true`): `OBJECTID, RouteIdentifier,
BeginAccumulatedRouteMile, BeginStateRouteMilepost, BeginAheadBackIndicator, EndAccumulatedRouteMile,
EndStateRouteMilepost, EndAheadBackIndicator, TrafficwayFeatureOrientCd, SnapshotDate, LRSDate,
YearConstructed, Notes, RoadName, FromRoad, ToRoad, OneWayRoadIndicator, WSDOTRegion, CountyName,
OwnerAgency, OwnerAgencyType, DataManagementAgency, Status, PlanningDocument, USBikeRoute,
BikeFacilityType, BikeFacilityWidth, BikeFacilityBufferWidth, BikeFacilitySeparationMaterial,
BikeFacilitySides, SurfaceType, …MaintainAgency×N, MaintenanceAgreement, Shape__Length`.
- `BikeFacilityType` distinct: `None, 'Bike Lane', 'Buffered Bike Lane', 'One-Way Separated Bike
  Lane', 'Shared-Use Path', 'Sidepath'`.
- `Status` distinct: `'Existing', 'In Construction', 'Planned'` → status filter = `Status='Existing'`.
- `USBikeRoute` distinct **non-null = []** (all values null on this layer as of 2026-06-16) — the
  US Bike Route designation lives on `ActiveTransportationData/8`, not here.

**`BikePathsAlongStateRoutes/0`:** `OBJECTID, Status, RegionName, CyclewayName, CyclewayType,
Owned_by, SurfaceMaintained_by, …, SurfaceType, SurfaceCondition, Width_foot, BollardPosts, ADARamps,
GlobalID, Shape__Length`.

**`ActiveTransportationData/8` (Approved US Bike Routes):** `OBJECTID, RoadName, JURFIPSDSG,
BikeRouteName, BikeRouteType, BikeRouteNumber, AASHTO_ApprovalDate, Segment, SegmentDescription,
Shape__Length`.

### Exact query URL pattern (use `arcgis.py`, swap `base_url` + `LAYER_PATH`)
```
https://data.wsdot.wa.gov/arcgis/rest/services/Shared/ActiveTransportationData/FeatureServer/8/query
  ?where=1%3D1&outFields=*&f=geojson&outSR=4326&resultOffset=0&resultRecordCount=1000
```
(For the inventory layers, substitute `Shared/BikeFacilitiesOnStateRoutes/FeatureServer/0/query`
with `where=Status%3D%27Existing%27`.) **Pagination verified empirically:** forcing
`resultRecordCount=50` on `BikeFacilitiesOnStateRoutes/0` (418 features) returns
`exceededTransferLimit: true` at **both** the top level **and** `properties.exceededTransferLimit`.
(SDOT's AGOL set only the nested `properties.*` flag; WSDOT's older ArcGIS sets both.) `arcgis.py`
`fetch_all_features` ORs the two locations → **works unchanged on both servers.** `resultOffset` +
`resultRecordCount` paging confirmed. (`supportsPagination: true` also present in layer metadata.)

**RegionProfile note:** `clients/arcgis.py` `base_url` default and the module-level `LAYER_PATH`
constant must become per-region config (plan §2 already calls this out).

**Endpoints hit:** `…/services?f=json`, `…/Shared?f=json`,
`…/BikeFacilitiesOnStateRoutes/FeatureServer{,/0}?f=json`, `…/ActiveTransportationData/FeatureServer{,/8}?f=json`,
`…/BikePathsAlongStateRoutes/FeatureServer{,/0}?f=json`, plus `query?returnCountOnly`/`returnDistinctValues` on each.

---

## 3. Proposed SDOT facility-class mapping → `{protected, lane, sharrow, greenway, other}`

In the explicit style of `facility_ingest.py::_FACILITY_CLASS_MAP`. **Source field = `CATEGORY`
on layer 2.** Unknown / `<Null>` → `other` + logged `facility_class_unknown` warning (same as NYC).

```python
# SDOT CATEGORY code -> normalized class. Codes decoded from the FeatureServer
# layer-2 renderer legend (drawingInfo.renderer.uniqueValueInfos), verified 2026-06-16.
_SDOT_FACILITY_CLASS_MAP = {
    "BKF-PBL":   "protected",   # Protected Bike Lanes  -> physically separated
    "BKF-OFFST": "protected",   # Misc Off Street facility -> off-street/separated  (⚠ see note B)
    "BKF-BL":    "lane",        # Painted Bike Lanes
    "BKF-BBL":   "lane",        # Buffered Bike Lanes   (no NYC analog; buffer != protection)
    "BKF-CLMB":  "lane",        # Climbing Lanes        (uphill bike lane; no NYC analog)
    "BKF-SHW":   "sharrow",     # Sharrows / shared lane markings
    "BKF-NGW":   "greenway",    # Neighborhood Greenways  (⚠ see note A — semantically contested)
    # <Null>/unrecognized -> "other" + logged warning
}
# Layer 1 (Multi-use Trails): no class field; every feature -> "greenway" (⚠ note A/B).
```

| `CATEGORY` | Label | → target | Confidence |
|---|---|---|---|
| `BKF-PBL` | Protected Bike Lanes | `protected` | high |
| `BKF-BL` | Painted Bike Lanes | `lane` | high |
| `BKF-BBL` | Buffered Bike Lanes | `lane` | high (no NYC analog) |
| `BKF-CLMB` | Climbing Lanes | `lane` | medium (no NYC analog) |
| `BKF-SHW` | Sharrows | `sharrow` | high |
| `BKF-NGW` | Neighborhood Greenways | `greenway` | **contested — see note A** |
| `BKF-OFFST` | Misc Off Street | `protected` *or* `greenway` | **contested — see note B** |
| `<Null>` | Unidentified | `other` (+ warning) | n/a |
| Multi-use Trails (layer 1, all) | — | `greenway` *or* `protected` | **see note A/B** |

### ⚠ Note A — Seattle "Neighborhood Greenway" is NOT NYC's "Greenway"

This is the single most important nuance in this doc. NYC's `grnwy='Greenway'` means an **off-street,
physically separated path** (Hudson River Greenway type) — high comfort, no car interaction.
Seattle's **"Neighborhood Greenway" (`BKF-NGW`)** is an **on-street, traffic-calmed residential
street** (sharrows + diverters + signals), *not* a separated path. If the `greenway` class in the
target taxonomy carries a "separated / high-comfort" weight in Phase-3 scoring, mapping `BKF-NGW`
(857 in-service features — the second-largest class) to `greenway` may **over-credit** an on-street
facility. Two defensible options, flagged for an explicit decision before writing the classifier:
1. `BKF-NGW → greenway` (name-parity, what the table above assumes), or
2. `BKF-NGW → sharrow` / a new low-stress-street class (physical-reality parity).
The truer analog to NYC's *off-street* greenway is **layer-1 Multi-use Trails** + `BKF-OFFST`.

### ⚠ Note B — `BKF-OFFST` and Multi-use Trails: `protected` vs `greenway`

NYC mapped off-street class I → `protected`. Seattle's off-street facilities split across
`BKF-OFFST` (misc off-street, 40) and the whole **layer-1 Multi-use Trails** set. These are the
real separated/off-street paths. Decision needed: do they go to `protected` (NYC's class-I rule) or
to `greenway` (semantic "off-street path")? The table above tentatively routes `BKF-OFFST →
protected` and Multi-use Trails → `greenway`; this is **inconsistent on purpose to surface the
choice** — pick one rule for all off-street and apply it uniformly. Recommend deciding *with* note A
(if `BKF-NGW` keeps `greenway`, consider routing the off-street paths to `protected` to keep
`greenway` meaning "the named NGW network"; or invert).

**Does Multi-use Trails map to `greenway`?** Functionally yes (off-street shared-use paths), but
see note B — confirm against how scoring weights `greenway` vs `protected` before locking it.

**Overlap note:** ingesting both layer 2 (`BKF-OFFST` off-street) and layer 1 (Multi-use Trails)
will likely double-represent some physical off-street paths. This is **not** a correctness bug —
Phase-3 geometric dedup (the 25 m buffer) absorbs coincident segments at ingest — but it is worth
knowing when reading by-class counts.

---

## 4. Counter data (pointers only — low priority, scoring input not a source)

### SDOT — native Socrata, `data.seattle.gov` (these ARE tabular)
- `smn3-rzf9` — **Bicycle Counters (Historical)** (the consolidated dataset; best single source).
- Per-location feeds: `y8xj-6xqb` Fremont Bridge, `m2yw-err8` 12th Ave S, `4hd3-wm3h` 7th Ave S of
  Blanchard, `2z5v-ecg8` Burke-Gilman N of NE 70th, plus several "(Out of Service)" counters
  (`uh8h-bme7`, `j4vh-b42a`, `mefu-7eau`).
- URL pattern: `https://data.seattle.gov/resource/smn3-rzf9.json?$limit=...&$offset=...` (native
  Socrata — `socrata.py` works here, ironically, for *counters* rather than facilities).

### WSDOT — UNVERIFIED, needs follow-up
- The candidate `Shared/BikePedPermCountData` (and guessed variants) **do not exist** in the WSDOT
  ArcGIS REST directory — confirmed 404 against `…/services?f=json` folder listing (`Shared` folder
  has no count/perm-count service; only `ActiveTransportationData`, `BikeFacilitiesOnStateRoutes`,
  `BikePathsAlongStateRoutes`). WSDOT permanent bike/ped counts are **UNVERIFIED — needs
  follow-up**: likely published via a separate WSDOT traffic-count program portal (not this REST
  service root). Optional glance at `TravelInformation`/`DataLibrary` folders; counters are
  explicitly low-priority, do not block on this.

---

## 5. RegionProfile values for Seattle

### Projected CRS — **EPSG:32610 (UTM 10N)** ✓ confirmed by reasoning
Seattle ≈ 122.33°W. UTM zone 10 spans 126°W–120°W → Seattle falls inside zone 10 → **EPSG:32610
(UTM 10N)** is correct (matches plan §3). NY's 32618 (UTM 18N) would silently distort all metric
thresholds — see plan §3, the highest-risk item.

### Bounds-guard box (proposed — generous Puget Sound box, [lat,lon])
The plan wants a generous metro bounds-guard analogous to NY's `lat 40–42 / lon −75…−73`. Proposed
generous Puget Sound box (covers Seattle + Tacoma + Everett + Eastside, with margin):

```
bounds_guard (lat_min, lat_max, lon_min, lon_max) = (47.0, 48.2, -122.7, -121.7)   # proposed
```
- City-of-Seattle tight bbox is ≈ lat 47.49–47.73 / lon −122.46…−122.22; the box above is the
  generous guard, not the clip polygon. The actual `config/seattle_boundary.geojson` clip polygon is
  a separate deliverable (data entry, not in scope here). **Marked "proposed" — tune to the chosen
  canon ride extent (e.g. Sammamish River Trail reaches ~47.67/−122.1; Lake WA Loop ~47.5/−122.2).**

### Sources base URLs (for `config/settings.py` env vars + RegionProfile)
- `socrata_base_url` (counters only): `https://data.seattle.gov`
- SDOT facilities (ArcGIS, **not** Socrata): base
  `https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services`,
  layer_path `SDOT_Bike_Facilities/FeatureServer/2/query`
- WSDOT (ArcGIS): base `https://data.wsdot.wa.gov/arcgis/rest/services`,
  layer_path `Shared/ActiveTransportationData/FeatureServer/8/query` (recommended) — see §2.

---

## Open follow-ups (tagged UNVERIFIED)

1. **WSDOT permanent counter source** — not in the ArcGIS REST root; find the WSDOT traffic-count
   portal. (low priority)
2. **WSDOT P2 layer choice** — `ActiveTransportationData/8` (US Bike Routes, 103) recommended as the
   designated-route analog, but `BikeFacilitiesOnStateRoutes/0` (418) / `BikePathsAlongStateRoutes/0`
   (392) are richer inventory; final pick is a corpus-design call (route vs facility semantics).
3. **`greenway` vs `protected` semantics (notes A & B)** — decide the off-street and Neighborhood-
   Greenway mappings against Phase-3 scoring weights *before* writing the classifier.
4. **`borough` column for Seattle** — no analog; `PRIMARYDISTRICTCD` is the closest. Leave NULL or
   repurpose (separate decision).
5. ~~WSDOT pagination flag~~ — **CLOSED**: verified empirically (forced `resultRecordCount=50` on
   the 418-feature layer → `exceededTransferLimit: true` at both top level and `properties.*`;
   `arcgis.py` handles both).
```
