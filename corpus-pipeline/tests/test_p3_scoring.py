"""TDD (rebuilt WP3): pure quality-scoring math — the mandated coverage test.

DB-free pure functions from p3_quality_scoring, with synthetic hand-computed
geometries (the PLAN §WP3 behavior list). Covers:
- facility_coverage_fraction on a straddling route,
- coverage-normalized protected fraction (a route half outside coverage is scored
  only over its in-coverage half — the mandated normalization test),
- the quality_score composite for known inputs.
"""

from __future__ import annotations

from shapely.geometry import LineString, Polygon

from freewheel_corpus.phases import p3_quality_scoring as p3


def _coverage_box():
    """Coverage = the western half-plane (lon <= -73.95) as a tall box."""
    return Polygon(
        [(-74.10, 40.70), (-73.95, 40.70), (-73.95, 40.90), (-74.10, 40.90), (-74.10, 40.70)]
    )


def test_facility_coverage_fraction_on_straddling_route():
    """A route running W→E across the coverage edge is ~half covered."""
    coverage = _coverage_box()
    # From lon -74.05 (inside) to -73.85 (outside); edge at -73.95 → ~50% inside.
    route = LineString([(-74.05, 40.80), (-73.85, 40.80)])
    frac = p3.facility_coverage_fraction(route, coverage)
    assert abs(frac - 0.5) < 0.05


def test_protected_fraction_normalized_over_in_coverage_half():
    """The mandated test: a route half outside coverage, with a protected facility
    blanketing its IN-coverage half, scores ~1.0 — NOT ~0.5 — because the fraction
    is normalized over the in-coverage portion only (out-of-coverage doesn't
    dilute)."""
    coverage = _coverage_box()
    route = LineString([(-74.05, 40.80), (-73.85, 40.80)])  # W half in, E half out
    # A protected facility covering only the in-coverage (western) half.
    protected = LineString([(-74.05, 40.80), (-73.95, 40.80)])
    by_class = {"protected": protected}

    prot_norm = p3.protected_lane_fraction_in_coverage(route, by_class, coverage)
    # In-coverage half is fully protected → ~1.0 after normalization.
    assert prot_norm > 0.9

    # Sanity: the UN-normalized fraction (over the whole route) would be ~0.5.
    prot_raw = p3.protected_lane_fraction(route, by_class)
    assert abs(prot_raw - 0.5) < 0.1


def test_route_fully_outside_coverage_scores_zero_protected():
    """A route entirely outside coverage → 0.0 protected (0/0 → 0 convention)."""
    coverage = _coverage_box()
    route = LineString([(-73.80, 40.80), (-73.70, 40.80)])  # all east of the edge
    by_class = {"protected": LineString([(-73.80, 40.80), (-73.70, 40.80)])}
    assert p3.protected_lane_fraction_in_coverage(route, by_class, coverage) == 0.0
    assert p3.facility_coverage_fraction(route, coverage) == 0.0


def test_quality_score_composite_matches_formula():
    """quality_score = 0.4*prot + 0.2*grn + 0.2*surf + 0.2*source_prior."""
    q = p3.quality_score(
        protected_lane_fraction=1.0,
        greenway_fraction=0.5,
        surface_quality=0.8,
        source="osm_relation",  # prior 1.0
    )
    expected = 0.4 * 1.0 + 0.2 * 0.5 + 0.2 * 0.8 + 0.2 * 1.0
    assert abs(q - expected) < 1e-9
