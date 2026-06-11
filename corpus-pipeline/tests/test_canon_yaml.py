"""TDD: config/canon.yaml is a well-formed DRAFT (WP4 deliverable check).

These are not "imagined behavior" tests — they verify the SHIPPED artifact obeys
its contract: the DRAFT banner is present (so no one mistakes the coords for
verified), every required named ride exists, there are ~40 entries, and every
coordinate passes the metro-bounds guard via the ONE swap helper (so a transposed
coord in the YAML fails the build rather than the live ORS run).
"""

from __future__ import annotations

from pathlib import Path

from freewheel_corpus.phases import p4_canon_and_generation as p4

_CANON = (
    Path(__file__).resolve().parents[1]
    / "src" / "freewheel_corpus" / "config" / "canon.yaml"
)

# The brief's required named rides (matched loosely by a slug substring).
_REQUIRED = [
    "central-park", "prospect-park", "manhattan-perimeter", "hudson-river-greenway",
    "brooklyn-waterfront", "coney-island", "jamaica-bay", "floyd-bennett",
    "kissena", "flushing-meadows", "city-island", "van-cortlandt",
    "old-croton-aqueduct", "bronx-river-pathway", "roosevelt", "governors-island",
    "staten-island-south", "9w-to-piermont", "9w-to-nyack", "river-road-nj",
    "state-line-lookout", "bear-mountain", "rockefeller", "jones-beach",
]


def test_canon_has_draft_banner():
    """The first non-empty line is the verbatim DRAFT banner."""
    text = _CANON.read_text()
    first = next(line for line in text.splitlines() if line.strip())
    assert first == (
        "# DRAFT — every coordinate requires human verification before ingestion"
    )


def test_canon_has_about_40_rides():
    """~40 entries (the brief target)."""
    entries = p4.load_canon(_CANON)
    assert 35 <= len(entries) <= 50, f"expected ~40 rides, got {len(entries)}"


def test_canon_includes_every_required_named_ride():
    """Every brief-required marquee ride is present (by slug substring)."""
    entries = p4.load_canon(_CANON)
    slugs = [e["slug"] for e in entries]
    missing = [
        req for req in _REQUIRED
        if not any(req in slug for slug in slugs)
    ]
    assert not missing, f"missing required canon rides: {missing}"


def test_every_canon_entry_has_required_fields():
    """Each entry has slug / start / expected_km / variants."""
    for entry in p4.load_canon(_CANON):
        assert entry.get("slug")
        assert entry.get("start")
        assert "expected_km" in entry
        assert entry.get("variants")


def test_every_canon_coordinate_passes_the_bounds_guard():
    """Every start + waypoint converts through the ONE swap helper without the
    metro-bounds guard raising — a transposed/typo'd coord fails HERE, not live."""
    for entry in p4.load_canon(_CANON):
        # start
        p4.latlon_to_lonlat(entry["start"])
        # base + variant waypoints
        for _, _, _, wps, _ in p4._iter_variants(entry):
            p4.latlon_list_to_lonlat(wps)
