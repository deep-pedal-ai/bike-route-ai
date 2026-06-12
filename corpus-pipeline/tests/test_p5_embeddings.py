from __future__ import annotations

import pytest

from freewheel_corpus.description import build_route_description
from freewheel_corpus.phases import p5_embeddings as p5


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
            self.results = [(model,) for model in sorted(self.conn.models)]
            return
        if "from routes order by id" in normalized:
            self.results = list(self.conn.route_rows)
            return
        if normalized.startswith("update routes set"):
            self.conn.updates.append(params)
            if params and params.get("embedding_model"):
                self.conn.models = {params["embedding_model"]}
            return
        self.results = []

    def fetchall(self):
        return self.results


class FakeConnection:
    def __init__(self, *, route_rows: list[tuple], models: set[str] | None = None) -> None:
        self.route_rows = route_rows
        self.models = models or set()
        self.updates: list[dict] = []

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)


@pytest.fixture(autouse=True)
def no_real_migrations(monkeypatch):
    monkeypatch.setattr(p5.migrations, "run_migrations", lambda _conn: ["002_embeddings.sql"])


def test_phase5_embeds_missing_rows_and_stores_description():
    conn = FakeConnection(
        route_rows=[
            (
                1,
                20.0,
                80.0,
                {"paved": 1.0},
                0.85,
                0.7,
                None,
                False,
                None,
            )
        ]
    )
    embedder = FakeEmbedder()

    stats = p5.run(conn, embedder=embedder)

    assert stats.migrations_applied == ["002_embeddings.sql"]
    assert stats.scanned == 1
    assert stats.embedded == 1
    assert stats.skipped_current == 0
    assert len(conn.updates) == 1
    assert conn.updates[0]["embedding"] == "[0.1,0.2,0.3]"
    assert conn.updates[0]["embedding_model"] == embedder.model_id
    assert embedder.texts == [conn.updates[0]["description"]]


def test_phase5_skips_rows_that_are_current():
    description = build_route_description(
        distance_km=20.0,
        ascent_m=80.0,
        surface_breakdown={"paved": 1.0},
        protected_lane_fraction=0.85,
        greenway_fraction=0.7,
    )
    conn = FakeConnection(
        route_rows=[
            (
                1,
                20.0,
                80.0,
                {"paved": 1.0},
                0.85,
                0.7,
                description,
                True,
                FakeEmbedder.model_id,
            )
        ],
        models={FakeEmbedder.model_id},
    )
    embedder = FakeEmbedder()

    stats = p5.run(conn, embedder=embedder)

    assert stats.embedded == 0
    assert stats.skipped_current == 1
    assert conn.updates == []
    assert embedder.texts == []


def test_phase5_reembeds_changed_description():
    conn = FakeConnection(
        route_rows=[
            (
                1,
                20.0,
                80.0,
                {"gravel": 1.0},
                0.1,
                0.1,
                "stale text",
                True,
                FakeEmbedder.model_id,
            )
        ],
        models={FakeEmbedder.model_id},
    )
    embedder = FakeEmbedder()

    stats = p5.run(conn, embedder=embedder)

    assert stats.embedded == 1
    assert conn.updates[0]["description"] != "stale text"


def test_mixed_model_guard_rejects_multiple_existing_models():
    conn = FakeConnection(route_rows=[], models={"fake:a", "fake:b"})

    with pytest.raises(p5.MixedEmbeddingModelError):
        p5.assert_no_mixed_embedding_models(conn)
