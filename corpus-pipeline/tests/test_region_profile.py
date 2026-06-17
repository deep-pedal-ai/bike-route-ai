"""Slice 2 behaviour-preservation: the ``ny`` profile must equal the old literals.

The RegionProfile refactor moved a pile of hardcoded NY constants into one object.
This file pins the ``ny`` profile to each former source-of-truth so the refactor is
provably a no-op for NY: if anyone edits a profile value (or a former constant)
without keeping the two in sync, one of these assertions fails.
"""

from __future__ import annotations

from freewheel_corpus import geometry
from freewheel_corpus.clients import arcgis
from freewheel_corpus.phases import (
    facility_ingest,
    p3_quality_scoring,
    p4_canon_and_generation as p4,
)
from freewheel_corpus.region_profile import NY, REGIONS, get_profile


def test_ny_crs_matches_geometry_default():
    assert NY.projected_crs == geometry.PROJECTED_CRS == "EPSG:32618"


def test_ny_bounds_match_former_metro_box():
    # The pre-Slice-2 metro.py guard box.
    assert (NY.lat_min, NY.lat_max) == (40.0, 42.0)
    assert (NY.lon_min, NY.lon_max) == (-75.0, -73.0)


def test_ny_config_paths_exist_and_point_at_committed_files():
    assert NY.boundary_path.name == "metro_boundary.geojson"
    assert NY.canon_path.name == "canon.yaml"
    assert NY.coverage_path.name == "nyc_coverage.geojson"
    for path in (NY.boundary_path, NY.canon_path, NY.coverage_path):
        assert path.exists(), f"committed config missing: {path}"


def test_ny_generation_seeds_match_former_p4_constant():
    assert list(NY.generation_seed_points) == list(p4.GENERATION_SEED_POINTS)


def test_ny_source_selectors_match_former_module_constants():
    assert NY.arcgis_layer_path == arcgis.LAYER_PATH
    # facility_dataset/facility_status_filter were folded into a FacilitySource
    # descriptor; the NY values must still resolve to the former literals.
    assert NY.facility_source.provider == "socrata"
    assert NY.facility_source.source == facility_ingest.SOURCE == "nyc_dot"
    assert NY.facility_source.dataset == facility_ingest.NYC_DOT_DATASET
    assert NY.facility_source.status_value == facility_ingest.CURRENT_STATUS
    # NY's Phase-2 ArcGIS host stays in settings (no per-profile override).
    assert NY.arcgis_base_url is None


def test_ny_coverage_path_matches_p3_default():
    assert NY.coverage_path == p3_quality_scoring._COVERAGE_PATH


def test_ny_canon_path_matches_p4_default():
    assert NY.canon_path == p4._DEFAULT_CANON_PATH


def test_get_profile_resolves_ny_and_rejects_unknown():
    assert get_profile("ny") is NY
    assert REGIONS["ny"] is NY
    try:
        get_profile("atlantis")
    except ValueError as exc:
        assert "atlantis" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("expected ValueError for unknown region")


def test_assert_in_bounds_accepts_ny_point_and_rejects_transposed():
    # Times Square, code order (lon, lat) — inside.
    NY.assert_in_bounds(-73.9855, 40.7580)
    # Transposed (lat, lon) — outside, must raise.
    from freewheel_corpus.region_profile import RegionBoundsError

    try:
        NY.assert_in_bounds(40.7580, -73.9855)
    except RegionBoundsError:
        pass
    else:  # pragma: no cover
        raise AssertionError("expected RegionBoundsError for transposed coordinate")
