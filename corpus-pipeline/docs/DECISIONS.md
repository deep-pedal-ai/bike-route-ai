# Decisions — Freewheel Corpus Pipeline

Locked outcomes of the planning grill (2026-06-10). Deep / hard-to-reverse
decisions are expanded as ADRs under [`adr/`](./adr/); this file is the full
record including the lighter calls. The phase-by-phase execution plan that
implements these is [`PLAN.md`](./PLAN.md).

## Repo context

The spec's premise is real: a React + Express serving app exists as an
npm-workspaces monorepo — `packages/{shared,server,client}`, root
`package.json` with `workspaces: ["packages/*"]`, plus `CLAUDE.md`,
`STANDARDS.md`, husky/eslint. (An earlier recon this session saw only
`LICENSE` + `README.md`; the app was populated into the working tree
mid-session — see the 2026-06-10 correction in [`BUILD-LOG.md`](./BUILD-LOG.md).)

This makes the isolation rules **live, not dormant**, and the Q1 decision below
is binding rather than forward-looking:
- `corpus-pipeline/` sits **outside `packages/`**, so the workspace glob excludes
  it automatically — no JS toolchain entanglement.
- The serving app is a **stub** (its `/routes` handler returns hardcoded data,
  no DB connection), so there is **no column-level DB contract to match** — the
  schema is greenfield. The `routes` table is nonetheless the **sole integration
  seam**; the server's `Route` DTO (`{id,name,distance,waypoints[lat,lng][]}`) is
  a downstream *projection* of it, owned by the server. We never modify
  serving-app types. See ADR-0001.
- `STANDARDS.md` / `CLAUDE.md` govern the JS packages; the Python pipeline
  follows Python conventions and this spec's filenames.

## Grill outcomes

| # | Question | Decision |
|---|----------|----------|
| Q1 | Where does the pipeline live, given no serving app? | `corpus-pipeline/` at repo root, fully self-contained. Isolation rules honoured as forward-looking. No stub serving app scaffolded. (ADR-0001) |
| Q2 | How do we verify, given AC#1 needs real PostGIS and we can't manage containers? | Provision an **ephemeral Neon Postgres branch** with PostGIS as the `DATABASE_URL` target; run `migrate → phase1 → phase3 → phase4 → stats` for real; tear the branch down after. Commits nothing infra-related — the pipeline still just consumes `DATABASE_URL`. |
| Q3 | Cross-source dedup: canon vs OSM collisions — who wins, when? | Full-table cross-source dedup pass in the final phase-3 re-run. Precedence `canon > osm_relation > nysdot > usbrs > generated`. Hard-delete loser, log both IDs. (ADR-0003) |
| Q4 | ORS quota accounting + elevation backfill policy | Track **per-endpoint** daily counters (ORS enforces per-endpoint). **No** mass elevation backfill for OSM relations — leave `ascent_m`/`descent_m` NULL and log it (protects the small `/elevation/line` quota). Canon + generated get ascent free from `/v2/directions` output. Phase-2 GPX missing z gets elevation only if budget remains, else NULL. |
| Q5 | Coordinate-order convention | `canon.yaml` stays human-friendly `[lat, lon]`. Code swaps to `[lon, lat]` (GeoJSON/ORS/shapely order) at the API boundary in exactly one helper. A guard rejects any coordinate outside lat 40–42 / lon −75…−73 so a swap fails loudly rather than routing into the ocean. |
| Q6a | NY State `7bg2-3faq` tabular dataset has no home table | **Lean: drop from v1** with a logged note (it is tabular, no geometry; `facility_segments.geom` is NOT NULL). Phase 3 subagent must **inspect the live dataset first and report**; only if it joins cleanly to routes by name do we reconsider before finalising. Never fabricate geometry. |
| Q6b | `is_loop` boolean loses loop / out-and-back / point-to-point distinction | No new column in migration 001. Persist canon's `out_and_back` flag into `routes.tags` JSONB now; derive geometric shape for other sources later. Keeps migration 001 lean for the embeddings-plan's documented future need. (ADR-0004 context) |
| Q7a | Projected CRS for buffer/overlap/length | **EPSG:32618 (UTM 18N, metres)** everywhere. No ft↔m conversion; full NJ/upstate coverage. (ADR-0002) |
| Q7b | NYC DOT historic vs current facilities | Filter `facility_segments` ingest to **currently-existing** facilities (exclude retired) before scoring — a retired lane must not score a route as protected. Inspect the actual status/retired field and document the filter in code. |

## Minor flags (resolved, no ADR)

- **Valhalla 200 km cap:** guard + log if a resampled input exceeds the cap; do
  not build elaborate chunk-and-stitch. After clipping to the metro polygon, no
  in-scope input is expected to exceed it; if one ever does, the log makes it
  visible rather than silently truncated.
- **`geom` / `geom_original` rule:** Phase 2 success (`match_quality ≥ 0.85`) →
  `geom` = map-snapped, `geom_original` = raw input. Failure (`< 0.85`) →
  `geom` = `geom_original` = raw input, log `failed_match`. Native sources
  (Phase 1 / canon) → `geom_original` = NULL.
- **`geom` is `LineString` while assembly can yield `MultiLineString`:** on gaps
  > 50 m keep the longest continuous component and log the dropped remainder; we
  accept that lossiness for v1.

## Working conventions (this build)

- All work on branch `feat/corpus-pipeline` in `bike-route-ai`. Never `main`.
- A running [`BUILD-LOG.md`](./BUILD-LOG.md) records every step and its outcome,
  appended as work happens (not batched).
- TDD throughout — vertical slices (one test → one impl → repeat), tests via
  public interfaces, never refactor while red. See [`PLAN.md`](./PLAN.md).
