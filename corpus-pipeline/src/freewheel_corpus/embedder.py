"""Embedding backend abstraction for Phase 5."""

from __future__ import annotations

import math
from typing import Protocol

from openai import OpenAI

OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
OPENAI_EMBEDDING_DIM = 1536
OPENAI_EMBEDDING_MODEL_ID = f"openai:{OPENAI_EMBEDDING_MODEL}"


class Embedder(Protocol):
    """Turns a route description into a fixed-length vector."""

    dim: int
    model_id: str

    def embed(self, text: str) -> list[float]:
        """Return a ``dim``-length embedding for ``text``."""


class OpenAIEmbedder:
    """OpenAI ``text-embedding-3-small`` embedder used by Phase 5."""

    dim = OPENAI_EMBEDDING_DIM
    model_id = OPENAI_EMBEDDING_MODEL_ID

    def __init__(self, *, api_key: str | None) -> None:
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required for phase5 embeddings")
        self._client = OpenAI(api_key=api_key)

    def embed(self, text: str) -> list[float]:
        response = self._client.embeddings.create(
            model=OPENAI_EMBEDDING_MODEL,
            input=text,
        )
        vector = response.data[0].embedding
        validate_embedding(vector, self.dim)
        return list(vector)


def validate_embedding(vector: list[float], dim: int) -> None:
    """Raise if ``vector`` cannot be stored in ``vector(dim)``."""
    if len(vector) != dim:
        raise ValueError(f"embedding dimension {len(vector)} does not match expected {dim}")
    if not all(math.isfinite(value) for value in vector):
        raise ValueError("embedding contains a non-finite value")


def vector_literal(vector: list[float], dim: int) -> str:
    """Serialize a Python vector into a pgvector input literal."""
    validate_embedding(vector, dim)
    return "[" + ",".join(format(value, ".10g") for value in vector) + "]"
