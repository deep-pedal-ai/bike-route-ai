---
status: accepted
---

# Python corpus pipeline isolated inside the (future) TypeScript monorepo

The Freewheel serving app will be React + Express (TypeScript). This ingestion
pipeline is geometry-heavy ETL (relation assembly, line merging, CRS
reprojection, buffered overlap math) where the Python geo ecosystem
(`shapely`, `pyproj`, `gpxpy`) is materially stronger than the JS equivalents.
Because the pipeline is an isolated batch job that shares **only the database**
with the serving app, toolchain mixing costs nothing at runtime.

**Decision:** the pipeline lives in `corpus-pipeline/`, manages its own
dependencies (uv, Python 3.12), and does not import from — nor is imported by —
the serving app, nor is it registered with any JS workspace tooling.

**Repo state (2026-06-10):** the serving app **exists** — an npm-workspaces
monorepo with `packages/{shared,server,client}` (React + Express + a shared
types package). (An earlier recon this session saw only `LICENSE` + `README.md`;
the app was populated into the working tree mid-session, timestamped 22:13. The
spec's premise was correct, just not yet checked out.) So the isolation rules
are **live, not hypothetical**:

- `corpus-pipeline/` lives at the repo root, **outside `packages/`**, so the
  root `package.json` `workspaces: ["packages/*"]` glob never picks it up — it is
  excluded from the JS toolchain by placement, exactly as intended.
- The husky pre-commit (`lint-staged` on `*.{ts,tsx}`) does not touch `.py`
  files, so the pipeline commits cleanly without JS linting.
- The serving app is currently a **stub**: `packages/server/.../routes.ts`
  returns hardcoded sample routes and does not connect to Postgres. There is
  therefore **no column-level DB contract to retrofit** — the schema is
  greenfield. But the `routes` table is the **sole integration seam**: when the
  server later reads the DB, its `Route` DTO (`{ id, name, distance, waypoints
  [lat,lng][] }`, see `packages/shared/src/index.ts`) is a *projection* of our
  richer `routes` table, mapped on the server side. We do not modify the serving
  app's types, and the server owns that mapping (including the PostGIS `[lon,lat]`
  → DTO `[lat,lng]` swap).

`STANDARDS.md` and the root `CLAUDE.md` govern the **JS packages**
(TypeScript/React/Express conventions); `corpus-pipeline/` follows Python
conventions and the filenames this spec dictates.

**Considered & rejected:** `osmlab/osm-api-js` — it wraps the OSM v0.6 *editing*
API (element CRUD, changesets, auth), not bulk spatial querying. Our OSM access
is Overpass bulk queries (a single HTTP POST), which needs no client library.
If the team later mandates a single toolchain, porting this to JS is a
deliberate rewrite decision, not an incidental one.
