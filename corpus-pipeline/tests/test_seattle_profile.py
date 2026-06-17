"""Slice 3 — Seattle RegionProfile + SDOT facility classifier + DRAFT config.

Pure / network-free + DB-free: the profile resolves with the correctness-critical
UTM-10N CRS, the committed DRAFT config files load and pass the bounds guard (so a
transposed [lat,lon]/[lon,lat] file fails HERE, not on a live run), the SDOT
CATEGORY mapping matches the locked Slice-3 decisions (esp. the two contested
calls: BKF-NGW -> sharrow, BKF-OFFST -> greenway, layer-1 -> greenway), and the
NY path is untouched (asserted in test_region_profile.py / test_facility_ingest.py).
"""

from __future__ import annotations

from freewheel_corpus.metro import load_metro_boundary
from freewheel_corpus.phases import facility_ingest as fi
from freewheel_corpus.phases import p4_canon_and_generation as p4
from freewheel_corpus.region_profile import (
    SEATTLE,
    FacilityLayer,
    REGIONS,
    get_profile,
)


# --- profile resolves with the right CRS / endpoints -------------------------

def test_seattle_resolves_and_uses_utm_10n():
    assert get_profile("seattle") is SEATTLE
    assert REGIONS["seattle"] is SEATTLE
    # The correctness gate: Seattle is six UTM zones west of NY -> 32610, not 32618.
    assert SEATTLE.projected_crs == "EPSG:32610"


def test_seattle_bounds_box_is_the_generous_puget_sound_box():
    assert (SEATTLE.lat_min, SEATTLE.lat_max) == (47.0, 48.0)
    assert (SEATTLE.lon_min, SEATTLE.lon_max) == (-122.6, -121.8)


def test_seattle_config_files_exist():
    assert SEATTLE.boundary_path.name == "seattle_boundary.geojson"
    assert SEATTLE.canon_path.name == "seattle_canon.yaml"
    assert SEATTLE.coverage_path.name == "seattle_coverage.geojson"
    for path in (SEATTLE.boundary_path, SEATTLE.canon_path, SEATTLE.coverage_path):
        assert path.exists(), f"committed DRAFT config missing: {path}"


def test_seattle_p2_routes_to_wsdot():
    # Designated routes: WSDOT host + Approved US Bike Routes layer 8.
    assert SEATTLE.arcgis_base_url == "https://data.wsdot.wa.gov/arcgis/rest/services"
    assert SEATTLE.arcgis_layer_path == (
        "Shared/ActiveTransportationData/FeatureServer/8/query"
    )


def test_seattle_facility_source_is_arcgis_sdot_two_layers():
    fs = SEATTLE.facility_source
    assert fs.provider == "arcgis"
    assert fs.source == "sdot"
    assert fs.base_url == (
        "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services"
    )
    assert len(fs.layers) == 2
    layer2, layer1 = fs.layers
    # layer 2 = Existing Bike Facilities: classed on CATEGORY, INSVC filter.
    assert layer2.layer_path.endswith("FeatureServer/2/query")
    assert layer2.class_field == "CATEGORY"
    assert (layer2.status_field, layer2.status_value) == ("CURRENT_STATUS", "INSVC")
    # layer 1 = Multi-use Trails: no class field, every feature -> greenway.
    assert layer1.layer_path.endswith("FeatureServer/1/query")
    assert layer1.class_field is None
    assert layer1.fixed_class == "greenway"


# --- DRAFT config loads + every coordinate passes the bounds guard -----------

def test_seattle_boundary_loads_and_every_vertex_in_bounds():
    # load_metro_boundary asserts every vertex is in the Seattle bounds box; a
    # transposed [lat,lon] file would raise here.
    boundary = load_metro_boundary(SEATTLE)
    assert boundary.is_valid
    assert not boundary.is_empty


def test_seattle_canon_has_draft_banner_and_marquee_rides():
    text = SEATTLE.canon_path.read_text()
    first = next(line for line in text.splitlines() if line.strip())
    assert first == (
        "# DRAFT — every coordinate requires human verification before ingestion"
    )
    slugs = [e["slug"] for e in p4.load_canon(profile=SEATTLE)]
    for req in ("burke-gilman", "alki", "lake-washington-loop", "mercer-island",
                "seward-park", "green-lake", "sammamish-river", "chief-sealth",
                "interurban", "elliott-bay"):
        assert any(req in s for s in slugs), f"missing Seattle canon ride: {req}"


def test_every_seattle_canon_coordinate_passes_the_bounds_guard():
    # Each start + waypoint converts through the ONE swap helper against the
    # SEATTLE bounds box; a transposed/typo'd coord fails HERE, not live.
    for entry in p4.load_canon(profile=SEATTLE):
        p4.latlon_to_lonlat(entry["start"], SEATTLE)
        for _, _, _, wps, _ in p4._iter_variants(entry):
            p4.latlon_list_to_lonlat(wps, SEATTLE)


# --- SDOT CATEGORY classifier (the genuinely new code path) ------------------

def test_sdot_category_codes_map_to_classes():
    n = lambda code: fi.normalize_sdot_facility_class({"CATEGORY": code}, "CATEGORY")
    assert n("BKF-PBL") == ("protected", False)
    assert n("BKF-BBL") == ("lane", False)
    assert n("BKF-BL") == ("lane", False)
    assert n("BKF-CLMB") == ("lane", False)
    assert n("BKF-SHW") == ("sharrow", False)


def test_sdot_contested_calls_match_locked_decisions():
    n = lambda code: fi.normalize_sdot_facility_class({"CATEGORY": code}, "CATEGORY")
    # Neighborhood Greenway is an on-street calmed street -> sharrow (NOT greenway).
    assert n("BKF-NGW") == ("sharrow", False)
    # Misc Off Street is a true off-street separated path -> greenway.
    assert n("BKF-OFFST") == ("greenway", False)


def test_sdot_null_or_unknown_category_is_other_and_flagged():
    n = lambda code: fi.normalize_sdot_facility_class({"CATEGORY": code}, "CATEGORY")
    assert n("ZZZ") == ("other", True)
    # Missing / null CATEGORY entirely.
    assert fi.normalize_sdot_facility_class({}, "CATEGORY") == ("other", True)
    assert fi.normalize_sdot_facility_class({"CATEGORY": None}, "CATEGORY") == (
        "other", True
    )


def test_multiuse_trail_layer_maps_every_feature_to_greenway():
    # Layer 1 has no CATEGORY; the fixed-class rule applies regardless of props.
    trail_layer = FacilityLayer(
        layer_path="SDOT_Bike_Facilities/FeatureServer/1/query",
        fixed_class="greenway",
    )
    cls, unknown = fi._classify_arcgis_feature({"SND_FEACODE": 99}, trail_layer)
    assert (cls, unknown) == ("greenway", False)
