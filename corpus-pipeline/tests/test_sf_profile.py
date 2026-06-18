"""Slice 4 — SF RegionProfile + SFMTA facility classifier + DRAFT config.

Pure / network-free + DB-free: the profile resolves with the correctness-critical
UTM-10N CRS, the committed DRAFT config files load and pass the bounds guard (so
a transposed [lat,lon]/[lon,lat] file fails HERE, not on a live run), the SFMTA
three-field class normaliser maps to the locked Slice-4 decisions, and existing
NY/Seattle paths are untouched.

Key SFMTA classification decisions locked in this file:
  - BIKE PATH → 'greenway' (off-street multi-use path)
  - BIKE LANE + barrier_ty='SAFE-HIT POSTS' → 'protected'
  - BIKE LANE (no barrier) → 'lane'
  - BIKE ROUTE + sharrow=1 → 'sharrow'
  - BIKE ROUTE + sharrow=0 → 'other' [UNVERIFIED judgment call]
  - unknown facility_t → 'other', was_unknown=True
"""

from __future__ import annotations

from freewheel_corpus.metro import load_metro_boundary
from freewheel_corpus.phases import facility_ingest as fi
from freewheel_corpus.phases import p4_canon_and_generation as p4
from freewheel_corpus.region_profile import (
    SF,
    FacilityLayer,
    REGIONS,
    get_profile,
)


# --- profile resolves with the right CRS / endpoints -------------------------

def test_sf_resolves_and_uses_utm_10n():
    assert get_profile("sf") is SF
    assert REGIONS["sf"] is SF
    # The correctness gate: Bay Area is UTM zone 10N (same zone as Seattle) → 32610.
    assert SF.projected_crs == "EPSG:32610"


def test_sf_bounds_box_is_the_nine_county_bay_area_box():
    assert (SF.lat_min, SF.lat_max) == (36.9, 38.2)
    assert (SF.lon_min, SF.lon_max) == (-123.0, -121.5)


def test_sf_config_files_exist():
    assert SF.boundary_path.name == "sf_boundary.geojson"
    assert SF.canon_path.name == "sf_canon.yaml"
    assert SF.coverage_path.name == "sf_coverage.geojson"
    for path in (SF.boundary_path, SF.canon_path, SF.coverage_path):
        assert path.exists(), f"committed DRAFT config missing: {path}"


def test_sf_p2_routes_to_caltrans_placeholder():
    # Phase 2 state designated routes: Caltrans ArcGIS (UNVERIFIED placeholder).
    # When a real Caltrans layer is found this assertion must be updated; the
    # placeholder returns zero features on a live run (Phase 2 logs "no features found").
    assert SF.arcgis_base_url == "https://caltrans-gis.dot.ca.gov/arcgis/rest/services"
    assert "PLACEHOLDER_UNVERIFIED" in SF.arcgis_layer_path


def test_sf_facility_source_is_arcgis_sfmta_one_layer():
    fs = SF.facility_source
    assert fs.provider == "arcgis"
    assert fs.source == "sfmta"
    assert "services.arcgis.com/ONuuV4O5ETfdTBvB" in fs.base_url
    assert len(fs.layers) == 1
    (layer,) = fs.layers
    # The bikeway network layer (no status filter: SFMTA has no retired/active column).
    assert "SFMTA_Bikeway_Network" in layer.layer_path
    assert "FeatureServer/0/query" in layer.layer_path
    assert layer.class_field == "facility_t"
    assert layer.status_field is None


# --- DRAFT config loads + every coordinate passes the bounds guard -----------

def test_sf_boundary_loads_and_every_vertex_in_bounds():
    # load_metro_boundary validates every vertex is in the SF bounds box; a
    # transposed [lat,lon] file would raise RegionBoundsError here.
    boundary = load_metro_boundary(SF)
    assert boundary.is_valid
    assert not boundary.is_empty


def test_sf_canon_has_draft_banner_and_marquee_rides():
    text = SF.canon_path.read_text()
    first = next(line for line in text.splitlines() if line.strip())
    assert first == (
        "# DRAFT — every coordinate requires human verification before ingestion"
    )
    slugs = [e["slug"] for e in p4.load_canon(profile=SF)]
    # Sample of slugs that must be present for the SF canon to be meaningful.
    for req in (
        "jfk-drive-ggp",
        "iron-horse-regional-trail",
        "sawyer-camp-crystal-springs",
        "stevens-creek-trail",
        "hawk-hill-marin-headlands",
        "mount-tamalpais-panoramic",
        "mount-diablo-south-gate",
        "nicasio-reservoir-loop",
        "old-la-honda-road",
        "grizzly-peak-tunnel-road",
    ):
        assert any(req in s for s in slugs), f"missing SF canon ride: {req}"


def test_sf_canon_has_58_rides():
    rides = p4.load_canon(profile=SF)
    assert len(rides) == 58, f"expected 58 SF rides, got {len(rides)}"


def test_every_sf_canon_coordinate_passes_the_bounds_guard():
    # Each start + waypoint is swapped through the ONE guarded helper against the
    # SF bounds box; a transposed / out-of-bounds coord raises RegionBoundsError.
    for entry in p4.load_canon(profile=SF):
        p4.latlon_to_lonlat(entry["start"], SF)
        for _, _, _, wps, _ in p4._iter_variants(entry):
            p4.latlon_list_to_lonlat(wps, SF)


# --- SFMTA three-field normaliser (the genuinely new code path) --------------

def test_sfmta_bike_path_maps_to_greenway():
    props = {"facility_t": "BIKE PATH", "barrier_ty": "", "sharrow": 0}
    assert fi.normalize_sfmta_facility_class(props) == ("greenway", False)


def test_sfmta_bike_lane_with_bollards_maps_to_protected():
    props = {"facility_t": "BIKE LANE", "barrier_ty": "SAFE-HIT POSTS", "sharrow": 0}
    assert fi.normalize_sfmta_facility_class(props) == ("protected", False)


def test_sfmta_bike_lane_no_barrier_maps_to_lane():
    props = {"facility_t": "BIKE LANE", "barrier_ty": "", "sharrow": 0}
    assert fi.normalize_sfmta_facility_class(props) == ("lane", False)


def test_sfmta_bike_route_with_sharrow_maps_to_sharrow():
    props = {"facility_t": "BIKE ROUTE", "barrier_ty": "", "sharrow": 1}
    assert fi.normalize_sfmta_facility_class(props) == ("sharrow", False)


def test_sfmta_bike_route_no_sharrow_maps_to_other_unverified():
    # UNVERIFIED judgment: route-signage-only corridor with no physical improvement.
    props = {"facility_t": "BIKE ROUTE", "barrier_ty": "", "sharrow": 0}
    assert fi.normalize_sfmta_facility_class(props) == ("other", False)


def test_sfmta_unknown_facility_type_is_other_and_flagged():
    props = {"facility_t": "MYSTERY TYPE", "barrier_ty": "", "sharrow": 0}
    assert fi.normalize_sfmta_facility_class(props) == ("other", True)


def test_sfmta_missing_facility_type_is_other_and_flagged():
    assert fi.normalize_sfmta_facility_class({}) == ("other", True)
    assert fi.normalize_sfmta_facility_class({"facility_t": None}) == ("other", True)


def test_sfmta_sharrow_string_1_also_maps_to_sharrow():
    # Some ArcGIS providers return numeric fields as strings — guard against it.
    props = {"facility_t": "BIKE ROUTE", "barrier_ty": "", "sharrow": "1"}
    assert fi.normalize_sfmta_facility_class(props) == ("sharrow", False)


# --- _classify_arcgis_feature SFMTA dispatch ---------------------------------

def test_classify_arcgis_feature_dispatches_to_sfmta_normalizer():
    layer = FacilityLayer(
        layer_path="SFMTA_Bikeway_Network/FeatureServer/0/query",
        class_field="facility_t",
    )
    props = {"facility_t": "BIKE PATH", "barrier_ty": "", "sharrow": 0}
    cls, unknown = fi._classify_arcgis_feature(props, layer, source_type="sfmta")
    assert (cls, unknown) == ("greenway", False)


def test_classify_arcgis_feature_sfmta_protected_lane():
    layer = FacilityLayer(
        layer_path="SFMTA_Bikeway_Network/FeatureServer/0/query",
        class_field="facility_t",
    )
    props = {"facility_t": "BIKE LANE", "barrier_ty": "SAFE-HIT POSTS", "sharrow": 0}
    cls, unknown = fi._classify_arcgis_feature(props, layer, source_type="sfmta")
    assert (cls, unknown) == ("protected", False)


def test_classify_arcgis_feature_no_source_type_falls_back_to_sdot():
    # Backward-compat: None source_type must not break the existing SDOT path.
    layer = FacilityLayer(
        layer_path="SDOT_Bike_Facilities/FeatureServer/2/query",
        class_field="CATEGORY",
        status_field="CURRENT_STATUS",
        status_value="INSVC",
    )
    cls, unknown = fi._classify_arcgis_feature({"CATEGORY": "BKF-PBL"}, layer)
    assert (cls, unknown) == ("protected", False)


def test_fixed_class_layer_still_works_without_source_type():
    # Fixed-class (Multi-use Trail layer) backward-compat.
    trail_layer = FacilityLayer(
        layer_path="SDOT_Bike_Facilities/FeatureServer/1/query",
        fixed_class="greenway",
    )
    cls, unknown = fi._classify_arcgis_feature({"SND_FEACODE": 99}, trail_layer)
    assert (cls, unknown) == ("greenway", False)
