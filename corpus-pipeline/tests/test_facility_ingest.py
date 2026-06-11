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
