po# POI Enrichment — Feature Description

> Fetch what's near each route — coffee, water, scenic overlooks, landmarks, bike
> services — cache it in our own tables, fold it into the searchable embedding,
> and show it as map pins + a detail-panel section. Turns a line on a map into a
> ride someone actually wants to take.
>
> **Status:** planned (design locked via grill, 2026-06-16). Provider/caching
> decision is [ADR-0005](../corpus-pipeline/docs/adr/0005-poi-enrichment-provider-and-caching.md).
> This document is the full feature record — decisions **and the reasoning behind
> them**, intended as design talking points, not just a spec.

---

## 1. The reframe that shapes everything

Freewheel has **two systems**, and the POI design only makes sense once they're
kept distinct:

- **`corpus-pipeline/` (Python, offline batch):** ingest OSM → map-match →
  quality-score → canonicalize → write deterministic descriptions → embed.
  Produces a **fixed corpus** of 149 routes in a PostGIS `routes` table.
- **`packages/server/` (TS, runtime):** query → extract constraints → embed query
  → pgvector cosine search → rerank top-5 with an LLM → return top-3 blurbs.

**Routes are retrieved, not generated.** A user query does semantic search over a
static corpus; nothing is synthesized per request. This kills the intuitive
"enrich the route _during_ vs _after_ the RAG" framing — there is no per-query
build to steer. Because the acceptance criteria also forbid live API calls on the
search path, the only place POIs can be fetched is **offline, in batch**. So the
real axes are:

- **What we precompute** (offline): POIs fetched once per route, cached, and a
  category summary folded into the embeddable text.
- **What we display** (query time): the already-cached POIs, joined and shown.

This is why "just show POIs automatically" is nearly free: the marginal
query-time cost is a SQL join, not an API call.

---

## 2. Corpus facts (verified against Neon, 2026-06-16)

- **149 routes**, all with valid `geom` LineStrings (EPSG:4326), all embedded,
  single embedding model (`openai:text-embedding-3-small`, 1536-dim).
- **Geographic spread is wide:** lat 40.2→44.2, lng −75.1→−72.8 — NYC up through
  the Hudson Valley / Catskills toward the Adirondacks. POI density swings from
  dense-urban to rural. This is the central tension the **selection policy** (§6)
  must handle.
- `routes.tags` holds only route-level keys (`variant`, `out_and_back`) — **no
  POI data, no `wikidata`/`wikipedia`.** POIs are absent because they were never
  fetched, not because an OSM augmentation skipped them.
- **Inputs are 100% present:** p6 needs only `geom`, which exists and is valid for
  all 149. **No full re-ingestion (p1–p4) is required.**

---

## 2a. External-source validation (Overpass spot-check, 2026-06-16)

The input side was verified against Neon; the **external source** was verified
against Overpass for one urban (Central Park, id 128) and one rural (NY Bike
Route 9 slice, id 1) bounding box. Two assumptions were load-bearing and are now
measured facts:

**Density — confirms the caps are necessary, not cosmetic.** Central Park's bbox
alone yields 65 cafés, 69 drinking-water, 49 historic, 10 viewpoints. Even after
the 150 m line-buffer (§6) shrinks that, urban routes far exceed any sane display
limit. The **12–15/route + 3–4/bucket cap is doing real work**; without it,
Manhattan routes would render an unusable wall of pins. Rural is the opposite — a
typical slice had 1 café, 1 viewpoint, 7 historic.

**Image coverage — sparse and bucket-skewed.** Via the `wikidata`→Wikidata P18→
Commons path:

| Bucket              | sampled total | with `wikidata` (→ likely image) |
| ------------------- | ------------- | -------------------------------- |
| historic / landmark | 49            | 22 (~45%)                        |
| cafe                | 65            | 2 (~3%)                          |
| drinking_water      | 69            | 0                                |
| viewpoint           | 10            | 0                                |

**Honest UX promise (state this to stakeholders):** this is **"bucket-colored
pins everywhere + a photo on the occasional landmark/scenic POI,"** _not_ a
photo-laden gallery. Coffee / water / rest / bike pins will be **icon-only**.
Images concentrate in the landmark bucket. This is still a strong, comprehensive
feature — but it is a _different promise_ than "rich, image-laden UI," and naming
it now prevents disappointment at implementation. The icon system (color + shape
per bucket) therefore carries most of the visual richness, not photos.

---

## 3. Architecture & the plug-and-play seam (primary design constraint)

A teammate may later rework the runtime (e.g. introduce LangChain). The POI
feature must **detach and re-attach** cleanly across such a change. It does,
because POI work lives in **exactly two places, both outside the retrieval
orchestration**:

1. **Data production** — phase **p6** + migration **003**. A pure offline batch
   that writes the `pois` / `route_pois` tables and folds category text into
   `description`. Zero knowledge of how queries are served.
2. **Presentation** — a `pois` array on the route-detail endpoint + a
   `RouteDetailPanel` section + a MapLibre layer. Pure read/display.

The **only** contact with the retrieval path is that the embedding now contains
category-level POI _words_ — and that is **just text in a column**: model-agnostic
and framework-agnostic. Any orchestrator (current Express, future LangChain)
reads the same `routes` table with the same `embedding`/`description` columns; the
enriched text rides along on the row.

**Falsifiable guarantee (not an adjective):**

- **Detach test:** remove p6 + the panel section → corpus builds, search works;
  you only lose pins and the category words.
- **Re-attach:** re-run p6 → p5. Fully reversible.
- **Tunability:** whitelist, radii, and caps live in a p6 config file — re-tune
  without code changes.

**Single coupling point to defend:** the category fold lives inside the
deterministic `build_route_description()` (Phase 5). If that builder is ever
replaced by an LLM-written description, the new prompt must still receive the
selected POI categories. Nothing else in the runtime touches POIs.

---

## 4. Pipeline changes (additive only)

```
migration 003_pois.sql      # new tables; p1–p4 schema untouched
        │
        ▼
phase p6  (NEW)             # reads existing geom → fetches POIs (Overpass +
        │                   #   Wikimedia) → writes pois / route_pois → folds
        │                   #   category summary into the description input
        ▼
phase p5  (RE-RUN)         # idempotent + content-addressed: detects the changed
                            #   description and re-embeds ONLY changed rows
```

**Why p5 needs no new orchestration:** `p5_embeddings.py` already rebuilds each
description, compares it to the stored one, and skips unchanged rows / re-embeds
changed ones (`p5_embeddings.py:65-66, 88-92`). Folding POI text changes the
description, so the re-embed cascades automatically. The plumbing we want already
exists.

**Open implementation item:** there is no unified phase runner today (p1–p5 look
invoked individually). p6 must be wired into whatever invokes the phases.

---

## 4a. The three integration surfaces

This is an _integration_, so name every surface it touches — not just the two
endpoints. Work lands in three places:

| Surface                                    | Files                                                                       | Work                                                                                                                                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pipeline** (Python)                      | `db/migrations/003_pois.sql`, `phases/p6_pois.py`, `description.py`, config | New migration + phase; extend `build_route_description()` with the category summary; config whitelist/radii/caps.                                                                                                                                                |
| **Server** (TS) — _the connecting surface_ | `corpus-client.ts`, `shared/src/corpus.ts`, route-detail handler            | Add a JOIN to `route_pois`/`pois` in the detail query (raw `ST_AsGeoJSON` SQL path); add a `pois` field to `CorpusRouteDetailProps` in `shared`; add Drizzle table defs for `pois`/`route_pois` **if** any read path uses Drizzle. No change to the search path. |
| **Client** (React)                         | `RouteDetailPanel.tsx`, `MapExplorer.tsx`, `use-corpus-route.ts`            | Panel section + MapLibre POI layer; POIs arrive in the existing detail response (no new hook).                                                                                                                                                                   |

The server surface is the one most easily under-scoped: the `pois` array does not
appear on the client until the corpus query JOINs it in **and** the shared type
carries it. Treat it as a discrete task, not a side effect of "extend the
response."

---

## 5. Data model

Normalized, because a POI (e.g. Bethesda Fountain) sits near several routes and
its Wikimedia image should be fetched **once per place**, not once per route-link
(the image fetch is the rate-limited part — dedup matters).

```sql
-- migration 003_pois.sql

CREATE TABLE pois (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    osm_type           text NOT NULL,          -- node | way | relation
    osm_id             bigint NOT NULL,
    name               text,
    category_bucket    text NOT NULL,          -- one of the 5 buckets (§6)
    geom               geometry(Point, 4326) NOT NULL,
    raw_osm_tags       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- provenance: re-bucket without re-fetch
    wikidata_id        text,
    image_url          text,
    image_license      text,                   -- licensing compliance, not optional
    image_attribution  text,                   -- Wikimedia requires attribution display
    last_refreshed_at  timestamptz NOT NULL DEFAULT now(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pois_osm_key UNIQUE (osm_type, osm_id)   -- idempotent re-runs
);
CREATE INDEX pois_geom_gist ON pois USING gist (geom);

CREATE TABLE route_pois (
    route_id           bigint NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    poi_id             bigint NOT NULL REFERENCES pois(id)   ON DELETE CASCADE,
    distance_m         double precision NOT NULL,   -- POI → route line
    matched_bucket     text NOT NULL,
    position_fraction  double precision,            -- 0..1 along route: powers spread + pin ordering
    PRIMARY KEY (route_id, poi_id)
);
```

**Deliberate choices, with reasons:**

- **Store the Commons _filename_ + license/attribution, not blobs (and not a raw
  `upload.wikimedia.org` URL).** Keeps the DB light. The raw upload URL is _not_
  guaranteed stable and direct hotlinking at scale is discouraged; storing the
  Commons filename (e.g. `File:Bethesda_Fountain.jpg`) lets the client derive a
  `Special:FilePath`/thumbnail URL at render time, which is stable and resizable.
  `image_url` may cache the derived thumbnail for convenience. The attribution
  columns are the licensing-compliance mechanism (Wikimedia requires attribution
  display), not decoration. Blobs would re-introduce a storage/caching burden for
  zero benefit at 149 routes.
- **Google Maps link is derived on the frontend** (`?api=1&query=LAT,LNG`), never
  stored — it is a pure function of geometry, so storing it would be stale
  duplication.
- **`raw_osm_tags` is retained** so we can re-bucket or re-rank later _without_
  re-hitting Overpass.
- **`UNIQUE(osm_type, osm_id)`** makes p6 re-runs idempotent (upsert on conflict).

**Serving:** extend the existing `GET /api/corpus/routes/:id` detail response with
a `pois` array (ordered by `position_fraction`). That fetch already fires when the
detail panel opens, POIs are bounded (~15), so it stays one round-trip — no new
endpoint.

---

## 6. Selection policy (the urban↔rural density fix)

Naïvely storing "everything within X meters" gives a wall of pins on Manhattan and
a clean set in the Adirondacks. Four sub-decisions, all tunable via p6 config:

**1. Proximity — category-dependent radius** via `ST_DWithin(geom::geography, …)`:

- **~150 m** for stop-types (café, water, food, toilets, bike repair) — you'd
  actually detour to them.
- **~400 m** for scenic/landmark types — a viewpoint or peak is worth seeing from
  farther.

**2. Category whitelist — curated, not "all OSM"** (raw OSM tags → 5 display
buckets). Everything else is dropped at fetch time:

| Bucket                 | OSM tags (examples)                                                                |
| ---------------------- | ---------------------------------------------------------------------------------- |
| **Coffee & food**      | `amenity=cafe`, `shop=bakery`, `amenity=restaurant`, `amenity=pub`                 |
| **Water & rest**       | `amenity=drinking_water`, `amenity=toilets`, `leisure=park`, `tourism=picnic_site` |
| **Scenic**             | `tourism=viewpoint`, `natural=peak`, `natural=waterfall`, `natural=beach`          |
| **Landmark / culture** | `historic=*`, `tourism=attraction`, notable `amenity=place_of_worship`             |
| **Bike services**      | `amenity=bicycle_repair_station`, `shop=bicycle`                                   |

**3. Caps + ranking — the density fix:** cap **~12–15 POIs per route**, max **~3–4
per bucket**, and **spread them along the route** (`position_fraction`) so you
don't return 15 clustered cafés. Rank within a bucket by: _has `wikidata`/`name`_
(notable / likely has an image) > closer to the line.

**4. Embedding summary counts the selected, capped set** — not raw OSM density —
so the vector reflects what a rider actually encounters.

---

## 7. Embedding-fold strategy

Freewheel's descriptions **deliberately exclude proper nouns** — they encode
_riding experience_ ("a mostly flat ride, fully paved, mostly on greenway"), not
named places. Folding raw POI names into the embedding would anchor the vector on
strings nobody searches by.

**Decision:** fold a **bounded, category-level summary** into the description, in
the same experiential register; keep proper nouns / coords / images / links in the
structured table for display only.

- **Into the embedding (category register):** _"…with several coffee stops, a
  riverside overlook, and a historic landmark along the way."_ → "coffee shop
  stop" / "scenic ride past a waterfall" queries now semantically match.
- **Into `pois` (display only):** name, exact location, image, OSM id, Google
  Maps deep-link — full richness on pins, zero embedding pollution.

**Why this register:** category words ("coffee", "viewpoint", "waterfall",
"historic") _are_ things riders query; proper nouns ("Blue Bottle") are not.
Category-level folding adds signal without noise, and stays in the register the
corpus already uses.

---

## 8. Refresh strategy

POIs are low-volatility (a café closes occasionally; a viewpoint never moves) and
the corpus rebuilds rarely. So **no live refresh.** p6 is a **re-runnable batch
keyed on `last_refreshed_at`** (skip POIs refreshed within N days, re-fetch the
rest — idempotent, like p5).

**Cadence:** run on **corpus rebuild, OR quarterly, whichever comes first** — by
hand or a quarterly scheduled job. A changed POI set changes the description, so
p5's idempotent re-embed cascades automatically.

**Why:** real-time freshness buys nothing for this data class and would add the
live-API dependency we explicitly designed out. A staleness tolerance of ~a
quarter is correct.

---

## 9. UI integration

Verified against the client (MapLibre GL via `react-map-gl/maplibre`):

- **Detail panel:** new section in `RouteDetailPanel.tsx` after the surface
  breakdown — POI cards grouped by bucket (icon + name + distance + image thumb +
  "View on Google Maps" link). Reuse existing badge/card/icon-row primitives and
  theme tokens (`--color-forest-panel`, `--color-bark-border`, …).
- **Map:** new MapLibre source + symbol/circle layer for the selected route's POIs
  (below the facilities layer), pins colored by bucket, ordered by
  `position_fraction`.
- **Search input:** unchanged — its placeholder already promises "a coffee shop
  stop and scenic ridge views"; this feature finally makes that real.
- **Fetch:** POIs arrive in the existing `useCorpusRoute(id)` response — no new
  hook required.

---

## 10. Observability & troubleshooting

Use the existing `ingest_log` table (`phase, source, event_type, route_id,
details, message`) — no new logging infra:

- p6 writes one row per route: `success` / `zero_pois` / `overpass_timeout` /
  `wikimedia_miss`, with counts in `details`.
- After a run: `SELECT … FROM ingest_log WHERE phase='p6' AND event_type='error'`
  to catch failures; `… event_type='zero_pois'` to find routes with no nearby
  POIs (expected for some rural routes — a signal, not a bug).
- p5 already emits skip/rewrite stats, so the re-embed cascade is observable too.

---

## 11. Acceptance criteria — mapping

| Original criterion                                                            | How this design meets it                                                                                                                           |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider, cost/quota, refresh cadence decided & written down                  | [ADR-0005](../corpus-pipeline/docs/adr/0005-poi-enrichment-provider-and-caching.md) (provider/caching) + §8 (refresh). Cost: $0 (OSM + Wikimedia). |
| POIs fetched per route, cached in our own table, no live calls on search path | §4–§5: p6 batch → `pois`/`route_pois`; search path is a pure DB read.                                                                              |
| POIs shown in the route detail panel                                          | §9.                                                                                                                                                |
| POI context folded into the route description / embedding input               | §7: category-level fold; p5 re-embed cascade.                                                                                                      |
| Refresh strategy in place                                                     | §8: re-runnable batch, quarterly / on rebuild.                                                                                                     |

---

## 12. Deferred / out of scope (v1)

- **Google Places** (photos/ratings) — deferred and reversible; requires
  accepting a Google basemap **and** live per-view hydration. See ADR-0005.
- **Query-time intent steering** (parse "coffee" from the NL query to re-rank) —
  not needed for v1; the category-fold already makes POI-rich routes surface
  semantically. Can layer on later without schema change.
- **Per-POI user actions** (save, rate, "add as waypoint") — future.

---

## 13. Open items to confirm at implementation

1. Wire p6 into however p1–p5 are invoked (no unified runner today).
2. Wikimedia image resolution path **(validated as the right path, §2a)**:
   resolve via the POI's `wikidata` tag → Wikidata `P18` (image) → Commons
   filename → derived thumbnail. Measured coverage: ~45% for historic/landmark,
   ~3% for cafés, ~0% for water/viewpoint — so **most POIs resolve to no image,
   and that is the expected case, not a blocking error.** Fallback = bucket icon
   only. The `image` OSM tag (direct) is even rarer than the wikidata path and is
   only a secondary fallback.
3. Final radius / cap constants in p6 config (defaults: 150 m / 400 m,
   12–15 per route, 3–4 per bucket).
4. **Rotate the Neon `DATABASE_URL`** — the credential in
   `packages/server/.env` was exposed during this planning session.
