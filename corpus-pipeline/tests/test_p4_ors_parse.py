"""TDD: ORS directions parsing for Phase 4 (WP4 behavior 1 — RLE extras decode).

The mandated tracer-bullet test. ORS ``/v2/directions`` returns ``extra_info``
(surface / waytype / steepness) as **run-length-encoded** ``[from_idx, to_idx,
value]`` triples where the indices are **coordinate indices** into the route's
geometry (verified against a real captured response — see
``tests/fixtures/ors_directions_central_park.json`` and the BUILD-LOG). Decoding
them means summing the projected (EPSG:32618) geometric length of
``coordinates[from..to]`` per value and normalizing to a ``{value -> fraction}``
breakdown that sums to ~1.0 — the same fractional-by-length shape Phase 2 / p3
scoring already consume.

Behaviors verified here are DB-free pure functions (no ORS network, no DB).
"""

from __future__ import annotations

import json
from pathlib import Path

from freewheel_corpus.phases import p4_canon_and_generation as p4

_FIXTURES = Path(__file__).resolve().parent / "fixtures"


def test_decode_rle_extra_uniform_value():
    """A single RLE triple spanning the whole line → that value at fraction 1.0."""
    # 4 coords, evenly spaced east-west; one triple [0, 3, 5] covers all of it.
    coords = [(-74.00, 40.75), (-73.99, 40.75), (-73.98, 40.75), (-73.97, 40.75)]
    values = [[0, 3, 5]]
    breakdown = p4.decode_rle_extra(coords, values)
    assert set(breakdown) == {5}
    assert abs(breakdown[5] - 1.0) < 1e-9


def test_decode_rle_extra_split_by_length_not_index_count():
    """Fractions are weighted by GEOMETRIC LENGTH, not the number of indices.

    Coords are deliberately non-uniformly spaced: the first segment is 3x the
    length of the rest combined, so an index-count weighting would give the
    wrong answer and a length weighting gives the right one.
    """
    # Segment lengths (approx, by longitude delta at this latitude): big, small, small.
    coords = [(-74.030, 40.75), (-74.000, 40.75), (-73.995, 40.75), (-73.990, 40.75)]
    # value 1 covers coords[0..1] (the long segment); value 2 covers coords[1..3].
    values = [[0, 1, 1], [1, 3, 2]]
    breakdown = p4.decode_rle_extra(coords, values)
    # 0.030 deg vs 0.010 deg of longitude → ~0.75 / ~0.25.
    assert abs(breakdown[1] - 0.75) < 0.02
    assert abs(breakdown[2] - 0.25) < 0.02
    assert abs(sum(breakdown.values()) - 1.0) < 1e-9


def test_decode_real_ors_extras_match_summary_amounts():
    """Decoded fractions match ORS's own ``extras.{type}.summary[].amount`` (%).

    Ground-truth cross-check against the real captured response: ORS reports a
    per-value ``amount`` percentage; our independent length-weighted decode must
    reproduce it (to within projection rounding, < 1.5%)."""
    data = json.loads((_FIXTURES / "ors_directions_central_park.json").read_text())
    feat = data["features"][0]
    coords = [(c[0], c[1]) for c in feat["geometry"]["coordinates"]]
    extras = feat["properties"]["extras"]

    for extra_type in ("surface", "waytype", "steepness"):
        values = extras[extra_type]["values"]
        breakdown = p4.decode_rle_extra(coords, values)
        for entry in extras[extra_type]["summary"]:
            decoded_pct = breakdown[int(entry["value"])] * 100.0
            assert abs(decoded_pct - entry["amount"]) < 1.5, (
                f"{extra_type} value={entry['value']}: decoded {decoded_pct:.2f}% "
                f"vs ORS {entry['amount']}%"
            )


def test_named_breakdown_maps_codes_to_strings():
    """The named breakdown turns ORS surface CODES into the string keys that the
    Phase-3 ``surface_quality`` scorer understands (e.g. 'asphalt', 'paved')."""
    # ORS surface code 3 = asphalt in the captured response (99.85% of the park ride).
    coords = [(-74.00, 40.75), (-73.98, 40.75)]
    values = [[0, 1, 3]]
    named = p4.named_breakdown("surface", coords, values)
    # The single dominant key must be a known surface string, not the raw code.
    assert all(isinstance(k, str) for k in named)
    assert "asphalt" in named
    assert abs(named["asphalt"] - 1.0) < 1e-9
