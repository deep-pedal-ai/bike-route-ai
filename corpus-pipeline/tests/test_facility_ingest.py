"""TDD (rebuilt WP3): NYC DOT facility normalization + DB ingest.

Pure normalization (network/DB-free) covers the I/II/III/L → class mapping, the
grnwy='Greenway' override, and unknown → 'other'. The DB ingest test (clean_db,
skips when TEST_DATABASE_URL unset) verifies rows land with the right class,
source='nyc_dot', a MultiLineString geom, the retired filter, and the by-class
histogram.
"""

from __future__ import annotations

from shapely.geometry import LineString, mapping

from freewheel_corpus import migrations
from freewheel_corpus.phases import facility_ingest
from freewheel_corpus.region_profile import SEATTLE


# --- pure normalization ------------------------------------------------------

def test_facilitycl_codes_map_to_classes():
    assert facility_ingest.normalize_facility_class({"facilitycl": "I"}) == ("protected", False)
    assert facility_ingest.normalize_facility_class({"facilitycl": "II"}) == ("lane", False)
    assert facility_ingest.normalize_facility_class({"facilitycl": "III"}) == ("sharrow", False)
    assert facility_ingest.normalize_facility_class({"facilitycl": "L"}) == ("other", False)


def test_greenway_overrides_facilitycl():
    """grnwy='Greenway' wins even when facilitycl is a known on-street code
    (matches the live oracle: segmentid 2579 is facilitycl='II', grnwy='Greenway'
    → greenway)."""
    cls, unknown = facility_ingest.normalize_facility_class(
        {"facilitycl": "II", "grnwy": "Greenway"}
    )
    assert cls == "greenway"
    assert unknown is False


def test_unknown_facilitycl_maps_to_other_and_flags_warning():
    cls, unknown = facility_ingest.normalize_facility_class({"facilitycl": "Z9"})
    assert cls == "other"
    assert unknown is True
    # Missing entirely → other + flagged too.
    assert facility_ingest.normalize_facility_class({}) == ("other", True)


# --- DB ingest ---------------------------------------------------------------

def _fc(features):
    return {"type": "FeatureCollection", "features": features}


def _feat(segmentid, *, facilitycl="II", grnwy=None, status="Current", boro="1"):
    props = {"segmentid": segmentid, "facilitycl": facilitycl, "status": status, "boro": boro}
    if grnwy is not None:
        props["grnwy"] = grnwy
    return {
        "type": "Feature",
        "properties": props,
        "geometry": mapping(LineString([(-73.99, 40.75), (-73.98, 40.75)])),
    }


def test_ingest_stores_classes_and_filters_retired(clean_db):
    migrations.run_migrations(clean_db)
    clean_db.commit()

    fc = _fc(
        [
            _feat(1, facilitycl="I"),                       # protected
            _feat(2, facilitycl="II"),                      # lane
            _feat(3, facilitycl="III"),                     # sharrow
            _feat(4, facilitycl="II", grnwy="Greenway"),    # greenway (override)
            _feat(5, facilitycl="Z9"),                      # unknown → other
            _feat(6, facilitycl="II", status="Retired"),    # filtered out
        ]
    )
    stats = facility_ingest.ingest_facilities(clean_db, fc)

    assert stats.stored == 5
    assert stats.skipped_retired == 1
    assert stats.by_class == {
        "protected": 1, "lane": 1, "sharrow": 1, "greenway": 1, "other": 1
    }

    with clean_db.cursor() as cur:
        cur.execute(
            "SELECT source, facility_class, GeometryType(geom), borough "
            "FROM facility_segments ORDER BY facility_id::int"
        )
        rows = cur.fetchall()
    assert all(r[0] == "nyc_dot" for r in rows)
    assert all(r[2] == "MULTILINESTRING" for r in rows)  # stored as MultiLineString
    # boro '1' → Manhattan
    assert rows[0][3] == "Manhattan"


def test_ingest_is_idempotent(clean_db):
    """Re-ingesting replaces (deletes the source's rows first) — no duplication."""
    migrations.run_migrations(clean_db)
    clean_db.commit()
    fc = _fc([_feat(1, facilitycl="I"), _feat(2, facilitycl="II")])

    facility_ingest.ingest_facilities(clean_db, fc)
    facility_ingest.ingest_facilities(clean_db, fc)

    with clean_db.cursor() as cur:
        cur.execute("SELECT count(*) FROM facility_segments")
        assert cur.fetchone()[0] == 2


# --- SDOT / Seattle ArcGIS ingest (region='seattle', source='sdot') ----------

def _sdot_feat(compkey, *, category=None, current_status="INSVC"):
    props = {"COMPKEY": compkey, "OBJECTID": compkey}
    if category is not None:
        props["CATEGORY"] = category
    if current_status is not None:
        props["CURRENT_STATUS"] = current_status
    return {
        "type": "Feature",
        "properties": props,
        "geometry": mapping(LineString([(-122.34, 47.62), (-122.33, 47.62)])),
    }


def _fake_arcgis_factory(pages_by_layer):
    """Build a client_factory that returns canned features per layer_path."""
    class _FakeClient:
        def __init__(self, *, base_url, layer_path):
            self.layer_path = layer_path

        def fetch_all_features(self, *, no_cache=False):
            return pages_by_layer.get(self.layer_path, [])

    return _FakeClient


def test_sdot_arcgis_ingest_classes_filters_and_partitions(clean_db):
    """Layer 2 features are CATEGORY-classed + INSVC-filtered; layer-1 features all
    map to greenway; rows land as source='sdot', region='seattle', borough NULL."""
    migrations.run_migrations(clean_db)
    clean_db.commit()

    fs = SEATTLE.facility_source
    layer2_path, layer1_path = fs.layers[0].layer_path, fs.layers[1].layer_path
    pages = {
        layer2_path: [
            _sdot_feat(10, category="BKF-PBL"),                       # protected
            _sdot_feat(11, category="BKF-NGW"),                       # sharrow (decision)
            _sdot_feat(12, category="BKF-OFFST"),                     # greenway (decision)
            _sdot_feat(13, category="ZZZ"),                           # other (+warning)
            _sdot_feat(14, category="BKF-PBL", current_status="UNDERCONS"),  # filtered
        ],
        layer1_path: [
            _sdot_feat(20, category=None),                            # greenway (fixed)
            _sdot_feat(21, category=None),                            # greenway (fixed)
        ],
    }

    stats = facility_ingest.ingest_arcgis_facilities(
        clean_db, fs, profile=SEATTLE,
        client_factory=_fake_arcgis_factory(pages),
    )

    assert stats.stored == 6        # 4 from layer2 (one UNDERCONS filtered) + 2 trails
    assert stats.skipped_retired == 1
    assert stats.unknown_classes == 1
    assert stats.by_class == {
        "protected": 1, "sharrow": 1, "greenway": 3, "other": 1,
    }

    with clean_db.cursor() as cur:
        cur.execute(
            "SELECT source, region, GeometryType(geom), borough "
            "FROM facility_segments"
        )
        rows = cur.fetchall()
    assert all(r[0] == "sdot" for r in rows)
    assert all(r[1] == "seattle" for r in rows)
    assert all(r[2] == "MULTILINESTRING" for r in rows)
    assert all(r[3] is None for r in rows)  # no SDOT borough analog


def test_sdot_arcgis_ingest_is_idempotent(clean_db):
    migrations.run_migrations(clean_db)
    clean_db.commit()
    fs = SEATTLE.facility_source
    pages = {fs.layers[0].layer_path: [_sdot_feat(1, category="BKF-BL")]}
    factory = _fake_arcgis_factory(pages)

    facility_ingest.ingest_arcgis_facilities(clean_db, fs, profile=SEATTLE, client_factory=factory)
    facility_ingest.ingest_arcgis_facilities(clean_db, fs, profile=SEATTLE, client_factory=factory)

    with clean_db.cursor() as cur:
        cur.execute("SELECT count(*) FROM facility_segments WHERE source = 'sdot'")
        assert cur.fetchone()[0] == 1
