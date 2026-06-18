"""Region profiles — the per-metro configuration bundle (multi-region, Slice 2).

A :class:`RegionProfile` gathers everything that is *geographically* specific to
one metro into a single object threaded through the clients and phases: the
bounds-guard box, the clip-boundary polygon, the **projected CRS** (the
correctness-critical one — see ``geometry.py`` / the multi-region plan §3), the
canon + coverage config files, the generation seed points, and the per-source
endpoints (ArcGIS layer path, facility dataset + status filter).

Before Slice 2 these values were scattered as module-level constants across
``metro.py`` (bounds, boundary), ``geometry.py`` (CRS), ``p4_canon_and_generation``
(canon path, seeds), ``p3_quality_scoring`` (coverage), ``facility_ingest``
(dataset/status), and ``clients/arcgis.py`` (layer path). Each was hardcoded to
NY. This module makes them a per-region lookup; ``ny`` reproduces exactly the old
literals (a behaviour-preserving refactor — `tests/test_region_profile.py` asserts
the ``ny`` profile equals each former constant, so any drift fails CI).

**This module imports nothing from the rest of the package** — it is a leaf, so
every other module can import it without an import cycle. The canonical NY values
live here; the former module constants are kept as thin aliases that point back at
``NY`` (one source of truth).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_CONFIG_DIR = Path(__file__).parent / "config"


@dataclass(frozen=True)
class FacilityLayer:
    """One ArcGIS facility layer + the rule that maps its features to a class.

    SDOT serves bike facilities across two layers with *different* shapes:

    - layer 2 (Existing Bike Facilities) carries a ``CATEGORY`` class field and a
      ``CURRENT_STATUS`` status field — its features are classed per-feature and
      status-filtered;
    - layer 1 (Multi-use Trails) has no class field at all (every feature is an
      off-street trail) and no status field — every feature maps to one fixed
      class.

    ``class_field`` / ``status_field`` are ``None`` for the second case;
    ``fixed_class`` then supplies the single class for every feature in the layer.
    Encoding the per-layer rule here keeps the ingest body from hardcoding
    "layer index N ⇒ greenway".
    """

    #: ArcGIS layer path appended to the facility ``base_url`` (e.g.
    #: ``"SDOT_Bike_Facilities/FeatureServer/2/query"``).
    layer_path: str
    #: the per-feature class field (``"CATEGORY"``), or ``None`` when the whole
    #: layer maps to ``fixed_class``.
    class_field: str | None = None
    #: the status field used for the belt-and-suspenders in-service filter
    #: (``"CURRENT_STATUS"``), or ``None`` when the layer has no status field.
    status_field: str | None = None
    #: the in-service status value (``"INSVC"``); paired with ``status_field``.
    status_value: str | None = None
    #: when ``class_field`` is ``None``, the single class every feature gets
    #: (e.g. ``"greenway"`` for Multi-use Trails).
    fixed_class: str | None = None


@dataclass(frozen=True)
class FacilitySource:
    """Where one region's bike-facility data (Phase 3) comes from + how to read it.

    Generalizes the formerly NY-only Socrata assumption into a clean per-region
    descriptor with two providers:

    - ``provider="socrata"`` (NY): a single tabular dataset (``dataset``) filtered
      server-side on ``status_field = status_value`` (``status='Current'``).
    - ``provider="arcgis"`` (Seattle): one or more :class:`FacilityLayer` s under a
      shared ``base_url``, each with its own class/status rule.

    ``source`` is the value written to (and queried back from) the
    ``facility_segments.source`` column — the partition the Phase-3 scorer reads
    (``nyc_dot`` for NY, ``sdot`` for Seattle).
    """

    #: ``"socrata"`` | ``"arcgis"``.
    provider: str
    #: the ``facility_segments.source`` column value (``"nyc_dot"`` | ``"sdot"``).
    source: str

    # --- socrata (NY) ----------------------------------------------------
    #: Socrata dataset id (``"mzxg-pwib"``); ``None`` for arcgis.
    dataset: str | None = None
    #: Socrata status field name (defaults to ``"status"``, NYC's column).
    status_field: str | None = "status"
    #: the "currently in service" status value (``"Current"``); ``None`` for arcgis.
    status_value: str | None = None

    # --- arcgis (Seattle) ------------------------------------------------
    #: the ArcGIS services base URL the layers hang off (SDOT's AGOL host).
    base_url: str | None = None
    #: the facility layers to ingest, each with its own class/status rule.
    layers: tuple[FacilityLayer, ...] = ()


@dataclass(frozen=True)
class RegionProfile:
    """Immutable bundle of one metro's geographic configuration.

    Threaded through the pipeline so a second metro (Seattle) runs the *same*
    phases with different geography. Frozen so a profile cannot be mutated mid-run
    (a region swap is selecting a different profile, never editing one).
    """

    #: the ``region`` column value and CLI selector (``"ny"`` | ``"seattle"``).
    key: str

    # --- bounds guard (PLAN Q5 / §WP0): a generous lat/lon box around the
    #     coverage area. A transposed [lat,lon]/[lon,lat] coordinate lands outside
    #     it and fails LOUDLY rather than silently querying the wrong region.
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float

    #: GeoJSON ``[lon, lat]`` clip polygon used to scope every source to the metro.
    boundary_path: Path

    #: projected metric CRS for ALL distance math (dedup buffer, length gates,
    #: facility proximity). NY = UTM 18N; Seattle needs UTM 10N. Using the wrong
    #: zone throws no error — it silently distorts every metre (plan §3).
    projected_crs: str

    #: hand-curated marquee rides (``[lat, lon]`` draft coords + variants).
    canon_path: Path

    #: facility-coverage polygon — fractions are normalized by the in-coverage
    #: route length (plan §4 / p3_quality_scoring).
    coverage_path: Path

    #: round-trip generation seed points, ``(lon, lat)`` (p4 generation).
    generation_seed_points: tuple[tuple[float, float], ...]

    # --- per-source endpoints (the base URLs stay in Settings/env; these are the
    #     region-specific layer/dataset selectors that were module constants).
    #: ArcGIS FeatureServer layer path appended to the Phase-2 designated-route
    #: base URL (NYSDOT State Bike Routes for NY, WSDOT US Bike Routes for WA).
    arcgis_layer_path: str
    #: where Phase-3 bike-facility data comes from + how to class it (Socrata for
    #: NY, ArcGIS for Seattle). See :class:`FacilitySource`.
    facility_source: FacilitySource

    #: per-region override for the **Phase-2 designated-route** ArcGIS base URL.
    #: ``None`` (NY) -> the CLI uses ``settings.arcgis_base_url`` (the NYSDOT host,
    #: still env-overridable for self-hosting). Seattle carries WSDOT's host so the
    #: two metros hit different ArcGIS servers without a settings change.
    arcgis_base_url: str | None = None

    def assert_in_bounds(self, lon: float, lat: float) -> None:
        """Raise :class:`RegionBoundsError` if ``(lon, lat)`` is outside the box.

        Coordinates are in code order: longitude first, latitude second. This is
        the transposition tripwire — the highest-risk bug class in the pipeline.
        """
        if not (self.lon_min <= lon <= self.lon_max and self.lat_min <= lat <= self.lat_max):
            raise RegionBoundsError(
                f"Coordinate (lon={lon}, lat={lat}) is outside the {self.key} bounds "
                f"(lat {self.lat_min}..{self.lat_max}, lon {self.lon_min}..{self.lon_max}). "
                f"This usually means a transposed [lat, lon] / [lon, lat] swap — "
                f"check coordinate order."
            )


class RegionBoundsError(ValueError):
    """A coordinate fell outside its region's bounds (likely a lat/lon swap)."""


# --- NY: the canonical first region. Every value here reproduces the literal it
#     replaced; tests/test_region_profile.py binds each back to its old constant.
NY = RegionProfile(
    key="ny",
    lat_min=40.0,
    lat_max=42.0,
    lon_min=-75.0,
    lon_max=-73.0,
    boundary_path=_CONFIG_DIR / "metro_boundary.geojson",
    projected_crs="EPSG:32618",  # UTM 18N, metres (ADR-0002)
    canon_path=_CONFIG_DIR / "canon.yaml",
    coverage_path=_CONFIG_DIR / "nyc_coverage.geojson",
    generation_seed_points=(
        (-73.9665, 40.7812),   # Central Park, Manhattan
        (-73.9690, 40.6602),   # Prospect Park, Brooklyn
        (-74.0090, 40.7033),   # Battery Park / Lower Manhattan
        (-73.9760, 40.7050),   # Brooklyn Bridge / DUMBO
        (-73.8740, 40.7460),   # Flushing Meadows, Queens
        (-73.8230, 40.6010),   # Rockaway / Jamaica Bay, Queens
        (-73.8900, 40.8930),   # Van Cortlandt Park, Bronx
        (-73.8650, 40.8500),   # Bronx River Pathway, Bronx
        (-74.1500, 40.5800),   # Staten Island south shore
        (-73.9100, 40.8500),   # Randalls Island / Harlem
        (-73.7900, 40.7300),   # Cunningham / Kissena, Queens
        (-73.9450, 40.7900),   # Upper East Side / East River, Manhattan
    ),
    arcgis_layer_path="Framework/State_Bike_Routes/FeatureServer/0/query",
    # NY facilities: NYC DOT via Socrata (mzxg-pwib), status='Current'. EXACTLY
    # the former (facility_dataset, facility_status_filter) literals.
    facility_source=FacilitySource(
        provider="socrata",
        source="nyc_dot",
        dataset="mzxg-pwib",
        status_field="status",
        status_value="Current",
    ),
    # NY's Phase-2 ArcGIS host stays in settings.arcgis_base_url (NYSDOT /hostingny).
    arcgis_base_url=None,
)


# --- Seattle / Puget Sound: Slice 3. DRAFT geographic data (coords marked DRAFT
#     in seattle_canon.yaml / seattle_boundary.geojson; verified by a human via the
#     phase4 +/-25% canon skip-loop before a production run). CRS is the
#     correctness gate: UTM 10N (32610), six zones west of NY's 18N.
_SDOT_FACILITY_BASE_URL = (
    "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services"
)
_WSDOT_ARCGIS_BASE_URL = "https://data.wsdot.wa.gov/arcgis/rest/services"

SEATTLE = RegionProfile(
    key="seattle",
    # Generous Puget Sound box (Seattle + Eastside margin) — a transposition
    # tripwire, NOT a tight clip. Tasks §1: lat 47.0-48.0, lon -122.6..-121.8.
    lat_min=47.0,
    lat_max=48.0,
    lon_min=-122.6,
    lon_max=-121.8,
    boundary_path=_CONFIG_DIR / "seattle_boundary.geojson",
    projected_crs="EPSG:32610",  # UTM 10N, metres — CRITICAL (plan §3)
    canon_path=_CONFIG_DIR / "seattle_canon.yaml",
    coverage_path=_CONFIG_DIR / "seattle_coverage.geojson",
    # DRAFT (lon, lat) seed points across the metro for p4 generation.
    generation_seed_points=(
        (-122.3035, 47.6700),   # Burke-Gilman / U-District
        (-122.4070, 47.5810),   # Alki Beach, West Seattle
        (-122.3580, 47.6260),   # Myrtle Edwards / Elliott Bay waterfront
        (-122.2620, 47.5550),   # Seward Park, Lake Washington
        (-122.3320, 47.6810),   # Green Lake
        (-122.2350, 47.5700),   # Mercer Island
        (-122.1080, 47.6700),   # Sammamish River Trail, Redmond
        (-122.3320, 47.6060),   # Downtown / Pike Place
        (-122.3870, 47.6900),   # Ballard / Golden Gardens
        (-122.2900, 47.7300),   # Lake Forest Park / north Burke-Gilman
    ),
    # WSDOT Approved US Bike Routes (designated routes) — the NYSDOT P2 analog.
    arcgis_layer_path="Shared/ActiveTransportationData/FeatureServer/8/query",
    arcgis_base_url=_WSDOT_ARCGIS_BASE_URL,
    # SDOT bike facilities via ArcGIS (NOT Socrata — the data.seattle.gov Socrata
    # ids are non-tabular federated views; see seattle-source-schema.md). Two
    # layers: layer 2 (Existing) classed per-feature on CATEGORY + INSVC filter;
    # layer 1 (Multi-use Trails) has no class field -> every feature greenway.
    facility_source=FacilitySource(
        provider="arcgis",
        source="sdot",
        base_url=_SDOT_FACILITY_BASE_URL,
        layers=(
            FacilityLayer(
                layer_path="SDOT_Bike_Facilities/FeatureServer/2/query",
                class_field="CATEGORY",
                status_field="CURRENT_STATUS",
                status_value="INSVC",
            ),
            FacilityLayer(
                layer_path="SDOT_Bike_Facilities/FeatureServer/1/query",
                fixed_class="greenway",  # all Multi-use Trails are off-street
            ),
        ),
    ),
)


# --- San Francisco / Bay Area: Slice 4. DRAFT geographic data (coords marked
#     DRAFT in sf_canon.yaml / sf_boundary.geojson; verified by a human via the
#     phase4 ±25% canon skip-loop before a production run). CRS is UTM 10N
#     (EPSG:32610) — same as Seattle; the Bay Area is in the same zone.
#
# Phase 2 (Caltrans state designated bike routes): UNVERIFIED — no usable ArcGIS
# FeatureServer layer found after thorough exploration of
# caltrans-gis.dot.ca.gov/arcgis/rest/services (folders: CHhighway, HQstatewide,
# SB1, CCBP, etc.). The arcgis_layer_path below is a placeholder that will return
# no features on a live run; Phase 2 will log "no features found" and continue.
# When a verified Caltrans ArcGIS layer is discovered, update these two values.
#
# Phase 3 (SFMTA city bike facilities): The Socrata dataset id s5wt-b6ed
# (mentioned in the task) returns HTTP 404 — this is the "Seattle lesson" about
# broken/federated Socrata views. The working source is the SFMTA Bikeway Network
# ArcGIS FeatureServer at services.arcgis.com/ONuuV4O5ETfdTBvB. The SFMTA
# facility class normalizer (normalize_sfmta_facility_class in facility_ingest.py)
# reads facility_t + barrier_ty + sharrow — three fields, not one. The
# ingest_arcgis_facilities function dispatches to it when source.source == 'sfmta'.
#
# MTC Bay Trail (second facility source): verified at
# services3.arcgis.com/i2dkYWmb4wHvYPda (status='Existing' filter; all greenway).
# DEFERRED — incorporating it requires extending FacilitySource to support multiple
# ArcGIS hosts per region (FacilityLayer.layer_path is concatenated to a single
# base_url). See docs/sf-source-schema.md §DEFERRED for the proposed extension.
_SFMTA_FACILITY_BASE_URL = (
    "https://services.arcgis.com/ONuuV4O5ETfdTBvB/arcgis/rest/services"
)
# Placeholder: Caltrans has no verified state-bike-route ArcGIS layer (UNVERIFIED).
# When a real layer is found, replace the base URL and layer path below.
_CALTRANS_ARCGIS_BASE_URL = "https://caltrans-gis.dot.ca.gov/arcgis/rest/services"

SF = RegionProfile(
    key="sf",
    # Generous nine-county Bay Area box — transposition tripwire, NOT a tight clip.
    lat_min=36.9,
    lat_max=38.2,
    lon_min=-123.0,
    lon_max=-121.5,
    boundary_path=_CONFIG_DIR / "sf_boundary.geojson",
    projected_crs="EPSG:32610",  # UTM 10N — same as Seattle (ADR-0002; Bay Area is UTM 10N)
    canon_path=_CONFIG_DIR / "sf_canon.yaml",
    coverage_path=_CONFIG_DIR / "sf_coverage.geojson",
    # DRAFT (lon, lat) seed points across the Bay Area for p4 generation.
    generation_seed_points=(
        (-122.4862, 37.7694),   # Golden Gate Park (SF)
        (-122.4716, 37.7996),   # Presidio (SF)
        (-122.4852, 37.8590),   # Sausalito ferry terminal (Marin)
        (-122.5457, 37.9060),   # Mill Valley / Tam trailhead (Marin)
        (-122.3027, 37.8654),   # Berkeley Marina (East Bay)
        (-122.2588, 37.8044),   # Lake Merritt / Oakland (East Bay)
        (-121.9998, 37.8219),   # Iron Horse Trail midpoint, Danville (East Bay)
        (-122.0574, 37.5577),   # Coyote Hills, Fremont (East Bay)
        (-122.3976, 37.5705),   # Sawyer Camp Trail, San Mateo (Peninsula)
        (-122.2614, 37.5631),   # Foster City / Bay Trail (Peninsula)
        (-122.0449, 37.3239),   # Stevens Creek Trail, Cupertino (South Bay)
        (-121.8863, 37.3382),   # Coyote Creek Trail, San Jose (South Bay)
    ),
    # Phase 2: UNVERIFIED placeholder — no Caltrans ArcGIS bike-route layer found.
    # Replace with the real layer path when discovered.
    arcgis_layer_path="PLACEHOLDER_UNVERIFIED/FeatureServer/0/query",
    arcgis_base_url=_CALTRANS_ARCGIS_BASE_URL,
    # Phase 3: SFMTA bike facilities via ArcGIS (Socrata s5wt-b6ed returns 404).
    # The SFMTA normalizer uses THREE fields (facility_t + barrier_ty + sharrow),
    # not a single class_field — see normalize_sfmta_facility_class() in
    # facility_ingest.py, dispatched when source.source == 'sfmta'.
    # No status_field: SFMTA dataset has no active/retired status column; all
    # features are treated as current (UNVERIFIED — no retired-facility filter).
    facility_source=FacilitySource(
        provider="arcgis",
        source="sfmta",
        base_url=_SFMTA_FACILITY_BASE_URL,
        layers=(
            FacilityLayer(
                layer_path="SFMTA_Bikeway_Network/FeatureServer/0/query",
                class_field="facility_t",   # primary field; SFMTA normalizer also reads
                                            # barrier_ty and sharrow (multi-field dispatch)
                # status_field=None: SFMTA has no active/retired status column
            ),
        ),
    ),
)


REGIONS: dict[str, RegionProfile] = {NY.key: NY, SEATTLE.key: SEATTLE, SF.key: SF}

#: The region used when a caller does not specify one — preserves the pre-Slice-2
#: behaviour (every row was NY) for existing call sites and tests.
DEFAULT_REGION = NY


def get_profile(key: str) -> RegionProfile:
    """Look up a region profile by key, or raise ``ValueError`` listing the keys."""
    try:
        return REGIONS[key]
    except KeyError:
        known = ", ".join(sorted(REGIONS))
        raise ValueError(f"Unknown region '{key}'. Known regions: {known}.") from None
