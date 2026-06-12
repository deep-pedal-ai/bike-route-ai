---
status: accepted
---

# Migration 001 excludes pgvector and all embedding columns

Freewheel is ultimately a RAG recommender, so a reader expects a vector column.
There deliberately isn't one yet. The embedding strategy (hosted vs local model,
therefore vector dimension) is undecided, and provisioning of the `pgvector`
extension is owned by a teammate and may lag.

**Decision:** migration 001 creates only plain PostGIS tables. It does **not**
`CREATE EXTENSION vector`, and `routes` has **no** `description`, `embedding`, or
`embedding_model` columns. Those arrive in a future migration once the strategy
is chosen.

**Why:** this keeps the entire ingestion build (Phases 1–4) runnable against a
plain PostGIS database even before pgvector exists, so DB provisioning and corpus
ingestion can proceed in parallel and unblock each other.

**Consequence:** Phase 5 (descriptions + embeddings) is out of scope for this
build. Its full design — description template, `Embedder` protocol, the future
`ALTER TABLE`, and the acceptance test — is captured in
[`docs/embeddings-plan.md`](../embeddings-plan.md) as a warm-start for a later
agent session. There is deliberately no `phase5` CLI command.
