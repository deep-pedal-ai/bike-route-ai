"""S5 (TDD): POI category-summary fold into ``build_route_description``.

The load-bearing test is byte-identity when no POI summary is supplied: all 149
production rows must produce the EXACT current string so the p5 re-embed does
NOT spuriously re-embed them (a paid call). The expected strings below are
captured from the *current* function output, not re-derived from logic, so a
spacing/wording regression fails loudly.
"""

from __future__ import annotations

from freewheel_corpus.description import build_route_description
from freewheel_corpus.poi.taxonomy import Bucket

# Captured verbatim from the current build_route_description for these inputs.
_FLAT_INPUTS = {
    "distance_km": 20.0,
    "ascent_m": 80.0,
    "surface_breakdown": {"paved": 0.9, "gravel": 0.1},
    "protected_lane_fraction": 0.8,
    "greenway_fraction": 0.7,
}
_FLAT_EXPECTED = (
    "A mostly flat ride, fully or almost fully paved, "
    "mostly on protected bikeway away from traffic."
)


def test_no_poi_summary_is_byte_identical_to_current_output():
    """poi_summary unset/None/{} -> EXACT current string (guards 149 rows)."""
    assert build_route_description(**_FLAT_INPUTS) == _FLAT_EXPECTED
    assert build_route_description(**_FLAT_INPUTS, poi_summary=None) == _FLAT_EXPECTED
    assert build_route_description(**_FLAT_INPUTS, poi_summary={}) == _FLAT_EXPECTED


def test_poi_summary_appends_category_clause_naming_buckets():
    """A non-empty summary appends ONE experiential category clause."""
    description = build_route_description(
        **_FLAT_INPUTS,
        poi_summary={
            Bucket.COFFEE_FOOD: 3,
            Bucket.SCENIC: 1,
            Bucket.LANDMARK: 1,
        },
    )

    # Still one sentence, ends with a period.
    assert description.endswith(".")
    # The base description is preserved as a prefix (no rewrite of existing text).
    assert description.startswith(_FLAT_EXPECTED[:-1])  # minus the closing period
    # Experiential category words appear (test 2).
    lowered = description.lower()
    assert "coffee" in lowered
    assert "scenic" in lowered or "overlook" in lowered
    assert "historic" in lowered
    # Pluralization: 3 coffee POIs read as "several", a single landmark as "a".
    assert "several coffee" in lowered


def test_poi_summary_never_contains_proper_nouns():
    """Only category words are folded; names/coords/links stay in the table."""
    description = build_route_description(
        **_FLAT_INPUTS,
        poi_summary={Bucket.COFFEE_FOOD: 2, Bucket.LANDMARK: 1},
    )

    # The raw machine slugs (with underscores: coffee_food, bike_services, ...)
    # are never leaked — only natural experiential phrasing reaches the text.
    assert "_" not in description
    for slug in (b.value for b in Bucket):
        if "_" in slug:  # multi-token slugs are machine ids, not English words
            assert slug not in description
    # No digits leak from the counts.
    assert not any(ch.isdigit() for ch in description)
