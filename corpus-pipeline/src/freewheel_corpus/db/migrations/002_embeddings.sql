-- Migration 002 — route descriptions + pgvector embeddings for semantic search.
--
-- Additive only: Phase 1-4 route facts remain the source of truth, and no ANN
-- index is created at this corpus size. The serving app performs an exact scan.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS description text,
    ADD COLUMN IF NOT EXISTS embedding vector(1536),
    ADD COLUMN IF NOT EXISTS embedding_model text;
