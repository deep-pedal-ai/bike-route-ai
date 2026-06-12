from __future__ import annotations

from freewheel_corpus.description import build_route_description


def test_description_is_deterministic():
    kwargs = {
        "distance_km": 20.0,
        "ascent_m": 80.0,
        "surface_breakdown": {"paved": 0.9, "gravel": 0.1},
        "protected_lane_fraction": 0.8,
        "greenway_fraction": 0.7,
    }

    assert build_route_description(**kwargs) == build_route_description(**kwargs)


def test_description_excludes_hard_numbers_names_and_coordinates():
    description = build_route_description(
        distance_km=22.0,
        ascent_m=123.0,
        surface_breakdown={"paved": 1.0},
        protected_lane_fraction=0.9,
        greenway_fraction=0.1,
    )

    assert "22" not in description
    assert "123" not in description
    assert "loop" not in description.lower()
    assert "hudson" not in description.lower()
    assert "40." not in description
    assert "-73." not in description


def test_description_omits_terrain_when_ascent_is_missing():
    description = build_route_description(
        distance_km=22.0,
        ascent_m=None,
        surface_breakdown={"gravel": 0.8, "paved": 0.2},
        protected_lane_fraction=0.1,
        greenway_fraction=0.1,
    )

    assert "flat" not in description
    assert "rolling" not in description
    assert "hilly" not in description
    assert "mostly gravel" in description


def test_description_captures_qualitative_experience():
    description = build_route_description(
        distance_km=12.0,
        ascent_m=330.0,
        surface_breakdown={"gravel": 0.7, "dirt": 0.2, "paved": 0.1},
        protected_lane_fraction=0.0,
        greenway_fraction=0.0,
    )

    assert "very hilly" in description
    assert "mostly gravel" in description
    assert "mixed-traffic" in description
