"""Env-gated Phase 5 ranking acceptance smoke test.

Runs only with a real corpus database and OpenAI key. This is intentionally a
behavioural ordering gate, not a unit test of prompt text or SQL internals.
"""

from __future__ import annotations

import os

import psycopg
import pytest

from freewheel_corpus.embedder import OpenAIEmbedder, vector_literal


pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL") or not os.environ.get("OPENAI_API_KEY"),
    reason="DATABASE_URL and OPENAI_API_KEY are required for the ranking gate",
)


EXPECTATIONS = [
    {
        "query": "mostly paved greenway away from traffic",
        "expected": ("Hudson River Greenway", "Ocean Parkway Greenway", "Prospect Park Loop"),
    },
    {
        "query": "very hilly ride with sustained climbing",
        "expected": ("River Road NJ", "Bear Mountain"),
    },
    {
        "query": "mostly paved with short unpaved segments",
        "expected": ("Central Park Loop (lower-loop)",),
    },
]


def test_phase5_ranking_gate_expected_routes_in_top_five():
    embedder = OpenAIEmbedder(api_key=os.environ.get("OPENAI_API_KEY"))

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        for expectation in EXPECTATIONS:
            rows = _search(conn, embedder, expectation["query"])
            names = [row[1] for row in rows]
            assert any(
                any(expected in name for name in names)
                for expected in expectation["expected"]
            ), f"{expectation['query']!r} returned {names!r}"


def test_phase5_ranking_gate_discriminating_pair_order():
    embedder = OpenAIEmbedder(api_key=os.environ.get("OPENAI_API_KEY"))

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        hilly_rows = _search(conn, embedder, "very hilly ride with sustained climbing", limit=10)
        greenway_rows = _search(conn, embedder, "flat protected paved greenway ride", limit=10)

    assert _best_rank(hilly_rows, "River Road NJ") < _best_rank(hilly_rows, "Hudson River")
    assert _best_rank(greenway_rows, "Hudson River") < _best_rank(greenway_rows, "River Road NJ")


def _search(conn, embedder: OpenAIEmbedder, query: str, *, limit: int = 5):
    embedding = vector_literal(embedder.embed(query), embedder.dim)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, embedding <=> %s::vector AS distance
            FROM routes
            WHERE embedding IS NOT NULL
            ORDER BY distance
            LIMIT %s
            """,
            (embedding, limit),
        )
        return cur.fetchall()


def _best_rank(rows, name_part: str) -> int:
    for index, row in enumerate(rows):
        if name_part in row[1]:
            return index
    return 999
