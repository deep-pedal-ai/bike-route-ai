# Infrastructure — Database handoff spec

> **Status: reference spec, NOT implemented by this pipeline.** The corpus
> pipeline owns *no* infrastructure. It consumes a single `DATABASE_URL` and fails
> fast with a clear message if PostGIS is absent (`db.check_postgis`). There is
> deliberately **no** `docker-compose.yml`, `Dockerfile`, Terraform, or any
> container/IaC config in this repo (PLAN §2 — "No container config"). The compose
> snippet below is a **reference example for whoever provisions the DB**, never a
> file that lives here.

This document hands off the database contract: what the pipeline needs from the
Postgres/PostGIS instance behind `DATABASE_URL`, what rights it requires, the
trivial data volume, and the forward-looking notes (pgvector, self-hosted
routing graphs) a future operator must honour.

---

## 1. Engine requirements

| Requirement | Baseline (spec) | What the live build actually used |
|-------------|-----------------|-----------------------------------|
| PostgreSQL | **16+** | **17.10** (Neon) |
| PostGIS | **3.4+** | **3.5.0** (Neon) |
| pgvector | **not required** (future — see below) | not installed |

The pipeline is engine-version-agnostic above the baseline: it uses only standard
PostGIS 3.4 functions (`ST_GeomFromText`, `ST_Buffer`, `ST_DWithin`,
`ST_Intersection`, `ST_Collect`, `ST_AsBinary`, GIST indexing). Migration `001`
runs `CREATE EXTENSION IF NOT EXISTS postgis` itself, so a fresh PostGIS-capable
database needs no manual extension setup beyond the extension being *available*.

The live corpus ran on an **ephemeral Neon Postgres branch** (Permaflux org,
project `freewheel-corpus`) chosen because it ships PostGIS and needs no local
container management. Any PostGIS-capable Postgres works equally — RDS, Cloud SQL,
a self-managed instance, or the reference container below.

---

## 2. The `DATABASE_URL` contract

The pipeline reads exactly one connection string from the environment:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
```

- It is the **sole integration seam** with the serving app. The Python pipeline
  *writes* the `routes` / `facility_segments` / `ingest_log` tables; the
  TypeScript serving app later *reads* `routes` and projects it to its `Route`
  DTO (`{id, name, distance, waypoints[lat,lng][]}`) on the server side. The
  pipeline never imports serving-app code and never modifies its types (ADR-0001).
- A second optional `TEST_DATABASE_URL` points at an **isolated** branch/database
  used only by the DB-backed tests + the Phase-1 integration test. Tests skip
  cleanly when it is unset; they **never** connect to `DATABASE_URL`.

### DDL rights

`migrate` requires a role that can:

- `CREATE EXTENSION postgis` (or have it pre-created — the migration uses
  `IF NOT EXISTS`),
- `CREATE TABLE` / `CREATE INDEX` (the three tables + their GIST indexes),
- `INSERT/UPDATE/DELETE` on those tables (Phase ingests; the cross-source dedup
  **hard-deletes** lower-precedence duplicate rows, ADR-0003).

A future `ALTER TABLE` for embeddings (see §5) will additionally need
`CREATE EXTENSION vector` rights. The handoff role should therefore be a DDL-
capable owner of the corpus schema, not a read-only app role.

---

## 3. Data volume (trivial)

The corpus is small and fits comfortably on the smallest tier of any managed
Postgres:

| Table | Live row count | Notes |
|-------|----------------|-------|
| `routes` | ~150 (≤ ~250 with full canon) | one geometry + scores per route |
| `facility_segments` | ~23,800 | NYC DOT bike facilities, MultiLineString |
| `ingest_log` | ~1,300 audit events | append-only; can be truncated freely |

Total on-disk footprint is well under 100 MB including GIST indexes. There is no
high write throughput (batch ingest, then read-mostly), so no special tuning,
connection pooling, or partitioning is needed for this dataset. Scoring queries
use `ST_DWithin` against the GIST index on `facility_segments.geom`, so the
24k-segment proximity lookups stay sub-second per route.

---

## 4. Reference compose snippet (NOT committed; illustrative only)

If an operator wants a local PostGIS for development instead of a managed branch,
this is a minimal reference. **Do not commit this as a file in this repo** — the
no-container-config invariant is binding here; this is documentation of *one* way
to satisfy the `DATABASE_URL` contract.

```yaml
# REFERENCE ONLY — do NOT add this file to corpus-pipeline/.
# A future migration adds pgvector (see embeddings-plan.md); when that lands,
# switch the image to one that bundles pgvector, e.g. pgvector/pgvector:pg16,
# or `CREATE EXTENSION vector` against an instance that has it available.
services:
  postgis:
    image: postgis/postgis:16            # PostGIS 3.4+ on PG16 (baseline)
    environment:
      POSTGRES_USER: freewheel
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: freewheel_corpus
    ports:
      - "5432:5432"
    volumes:
      - freewheel_pgdata:/var/lib/postgresql/data
volumes:
  freewheel_pgdata:
```

Then `DATABASE_URL=postgresql://freewheel:change-me@localhost:5432/freewheel_corpus`
and `uv run freewheel-corpus migrate`.

> **pgvector is a future add, not part of this image choice.** The baseline
> `postgis/postgis:16` image does **not** bundle pgvector. The embedding columns
> and the `vector` extension arrive in a later migration once the embedding
> strategy is chosen (ADR-0004, `embeddings-plan.md`); at that point swap to a
> PostGIS+pgvector image (or install pgvector into the existing instance).

---

## 5. Forward-looking notes for the operator

### pgvector / embeddings (Phase 5, not implemented)

Migration `001` deliberately creates **only plain PostGIS tables** — no `vector`
extension and no `description` / `embedding` / `embedding_model` columns
(ADR-0004). This keeps the entire ingestion build runnable on a plain PostGIS DB
even before pgvector exists, so DB provisioning and corpus ingestion can proceed
in parallel. The full embedding design — description template, `Embedder`
protocol, the future `ALTER TABLE` adding `CREATE EXTENSION vector` + the columns,
and the ranking acceptance test — is captured in
[`embeddings-plan.md`](./embeddings-plan.md) as a warm-start for a later session.

### Self-hosted routing graph extent (ORS / Valhalla)

The pipeline routes canon + generated rides via **openrouteservice** and
map-matches GPX/NYSDOT via **Valhalla**, both currently the public endpoints (each
base URL is a single env var so they self-host later). When a teammate stands up
self-hosted ORS/Valhalla instances, the routing **graph extract must cover the
bounding box of ALL stored route geometry**, not just the metro boundary polygon.
Several canon rides (Bear Mountain via 9W, Nyack/Piermont, River Road NJ, State
Line Lookout) extend well north of NYC into the lower Hudson Valley and NJ; a
graph clipped to just the five boroughs would fail to route or map-match them.
Size the graph extract to the union of every route's bbox (run a
`SELECT ST_Extent(geom) FROM routes` to get it), with a margin.
