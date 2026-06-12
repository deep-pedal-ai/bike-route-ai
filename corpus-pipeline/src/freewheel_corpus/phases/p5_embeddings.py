"""Phase 5 — deterministic route descriptions + embeddings.

Owns the index-time side of semantic search: migration 002, stored descriptions,
embedding vectors, and the mixed-model guard. Query-time ranking lives in the
TypeScript serving app.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psycopg

from freewheel_corpus import migrations
from freewheel_corpus.description import build_route_description
from freewheel_corpus.embedder import Embedder, vector_literal

PHASE = "phase5"


class MixedEmbeddingModelError(RuntimeError):
    """Raised when existing route embeddings use multiple model IDs."""


@dataclass
class Phase5Stats:
    """Counters returned by :func:`run`."""

    migrations_applied: list[str]
    scanned: int = 0
    embedded: int = 0
    skipped_current: int = 0
    model_id: str = ""


_ROUTES_SQL = """
SELECT
    id,
    distance_km,
    ascent_m,
    surface_breakdown,
    protected_lane_fraction,
    greenway_fraction,
    description,
    embedding IS NOT NULL AS has_embedding,
    embedding_model
FROM routes
ORDER BY id
"""

_UPDATE_SQL = """
UPDATE routes SET
    description = %(description)s,
    embedding = %(embedding)s::vector,
    embedding_model = %(embedding_model)s,
    updated_at = now()
WHERE id = %(id)s
"""


def run(conn: psycopg.Connection, *, embedder: Embedder) -> Phase5Stats:
    """Apply migration 002 and backfill route descriptions + embeddings.

    Idempotent: rows whose stored description, embedding, and model are current
    are skipped; changed descriptions or stale/missing embeddings are re-written.
    """
    migrations_applied = migrations.run_migrations(conn)
    assert_no_mixed_embedding_models(conn)

    stats = Phase5Stats(migrations_applied=migrations_applied, model_id=embedder.model_id)

    with conn.cursor() as read_cur, conn.cursor() as write_cur:
        read_cur.execute(_ROUTES_SQL)
        for row in read_cur.fetchall():
            route = _row_to_route(row)
            stats.scanned += 1

            description = build_route_description(
                distance_km=route["distance_km"],
                ascent_m=route["ascent_m"],
                surface_breakdown=route["surface_breakdown"],
                protected_lane_fraction=route["protected_lane_fraction"],
                greenway_fraction=route["greenway_fraction"],
            )

            if (
                route["description"] == description
                and route["has_embedding"]
                and route["embedding_model"] == embedder.model_id
            ):
                stats.skipped_current += 1
                continue

            embedding = embedder.embed(description)
            write_cur.execute(
                _UPDATE_SQL,
                {
                    "id": route["id"],
                    "description": description,
                    "embedding": vector_literal(embedding, embedder.dim),
                    "embedding_model": embedder.model_id,
                },
            )
            stats.embedded += 1

    assert_no_mixed_embedding_models(conn)
    return stats


def assert_no_mixed_embedding_models(conn: psycopg.Connection) -> None:
    """Enforce the spec invariant that one corpus never mixes vector spaces."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT embedding_model
            FROM routes
            WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL
            GROUP BY embedding_model
            ORDER BY embedding_model
            """
        )
        models = [row[0] for row in cur.fetchall()]

    if len(models) > 1:
        raise MixedEmbeddingModelError(
            "routes.embedding contains multiple embedding_model values: "
            + ", ".join(models)
        )


def _row_to_route(row: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": row[0],
        "distance_km": row[1],
        "ascent_m": row[2],
        "surface_breakdown": row[3],
        "protected_lane_fraction": row[4],
        "greenway_fraction": row[5],
        "description": row[6],
        "has_embedding": row[7],
        "embedding_model": row[8],
    }
