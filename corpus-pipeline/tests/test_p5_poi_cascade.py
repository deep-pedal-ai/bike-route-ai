"""S7 (TDD): the p5 re-embed cascade under p6 output.

No DB: a fake connection replays the per-route POI-bucket counts that p6 would
have written to ``route_pois``. The two load-bearing behaviors:

1. With POIs for a route, p5 folds the category clause into that route's
   description (S5), which changes the text and triggers a re-embed.
2. p5 re-embeds **only** the changed row — a route with no POIs keeps its
   byte-identical pre-POI description and is skipped. This is what keeps the
   re-embed (a paid call) scoped to exactly what p6 changed.
"""

from __future__ import annotations

import pytest

from freewheel_corpus.description import build_route_description
from freewheel_corpus.phases import p5_embeddings as p5
from freewheel_corpus.poi.taxonomy import Bucket

_INPUTS = {
    "distance_km": 20.0,
    "ascent_m": 80.0,
    "surface_breakdown": {"paved": 1.0},
    "protected_lane_fraction": 0.85,
    "greenway_fraction": 0.7,
}
# The description p5 currently stores for _INPUTS (no POIs).
_BASE_DESCRIPTION = build_route_description(**_INPUTS)


class FakeEmbedder:
    dim = 3
    model_id = "fake:test-model"

    def __init__(self) -> None:
        self.texts: list[str] = []

    def embed(self, text: str) -> list[float]:
        self.texts.append(text)
        return [0.1, 0.2, 0.3]


class FakeCursor:
    def __init__(self, conn: "FakeConnection") -> None:
        self.conn = conn
        self.results: list[tuple] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_args) -> None:
        return None

    def execute(self, sql: str, params=None) -> None:
        normalized = " ".join(sql.split()).lower()
        if normalized.startswith("select embedding_model"):
            self.results = [(m,) for m in sorted(self.conn.models)]
        elif "from route_pois" in normalized:
            self.results = list(self.conn.poi_rows)
        elif "from routes order by id" in normalized:
            self.results = list(self.conn.route_rows)
        elif normalized.startswith("update routes set"):
            self.conn.updates.append(params)
            if params and params.get("embedding_model"):
                self.conn.models = {params["embedding_model"]}
        else:
            self.results = []

    def fetchall(self):
        return self.results


class FakeConnection:
    def __init__(self, *, route_rows, poi_rows, models) -> None:
        self.route_rows = route_rows
        self.poi_rows = poi_rows  # (route_id, matched_bucket, count) like route_pois
        self.models = models
        self.updates: list[dict] = []

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)


@pytest.fixture(autouse=True)
def no_real_migrations(monkeypatch):
    monkeypatch.setattr(p5.migrations, "run_migrations", lambda _conn: [])


def _current_row(route_id: int) -> tuple:
    """A route already embedded with its current (pre-POI) description + model."""
    return (
        route_id,
        _INPUTS["distance_km"],
        _INPUTS["ascent_m"],
        _INPUTS["surface_breakdown"],
        _INPUTS["protected_lane_fraction"],
        _INPUTS["greenway_fraction"],
        _BASE_DESCRIPTION,
        True,
        FakeEmbedder.model_id,
    )


def test_p6_pois_trigger_a_reembed_for_only_the_changed_route():
    """Route 1 gains POIs (description changes -> re-embed); route 2 has none and
    is skipped (byte-identical description)."""
    conn = FakeConnection(
        route_rows=[_current_row(1), _current_row(2)],
        poi_rows=[
            (1, Bucket.COFFEE_FOOD.value, 3),
            (1, Bucket.SCENIC.value, 1),
        ],
        models={FakeEmbedder.model_id},
    )
    embedder = FakeEmbedder()

    stats = p5.run(conn, embedder=embedder)

    # Exactly one row re-embedded — the one p6 changed.
    assert stats.embedded == 1
    assert stats.skipped_current == 1
    assert len(conn.updates) == 1

    updated = conn.updates[0]
    assert updated["id"] == 1
    # The folded text carries the category clause (S5) and is no longer the base.
    assert updated["description"] != _BASE_DESCRIPTION
    assert "coffee" in updated["description"].lower()
    assert embedder.texts == [updated["description"]]


def test_no_route_pois_means_no_reembed():
    """The pre-p6 state: empty route_pois -> every description byte-identical ->
    nothing re-embeds (guards the 149 rows)."""
    conn = FakeConnection(
        route_rows=[_current_row(1)],
        poi_rows=[],
        models={FakeEmbedder.model_id},
    )
    embedder = FakeEmbedder()

    stats = p5.run(conn, embedder=embedder)

    assert stats.embedded == 0
    assert stats.skipped_current == 1
    assert conn.updates == []
    assert embedder.texts == []
