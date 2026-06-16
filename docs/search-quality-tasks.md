# Search quality work

Notes from digging into the Neon corpus. The short version: search feels dumb, but it's not because the data is bad. It's because most of the good columns never make it into the descriptions, the embeddings, or the queries.

There are 149 routes. Every one has an embedding. But the stored descriptions collapse down to **21 distinct strings**, and 124 of the 149 say some variant of "surface mix is not specified, mostly mixed-traffic riding." Same text in means same vector out, so semantic search genuinely cannot tell a 10 km greenway apart from a 3 km local street if they happened to land on the same boilerplate sentence.

Example of the collapse — these all share that one description, but look at how different they actually are:

| Route | Distance | Protected | Greenway | Facility coverage |
|---|---|---|---|---|
| Harlem River Greenway | 10.3 km | 10% | 8% | 100% |
| 73rd Avenue | 6.8 km | 12% | 12% | 100% |
| 31st Avenue | 6.1 km | 19% | 0% | 100% |
| 34th Avenue | 3.5 km | 19% | 0% | 100% |
| 110th Street | 3.1 km | 8% | 0% | 100% |

The numbers in that table already exist on every row. We just throw them away.

I've split the work into two buckets. Integration is wiring up data we already have. Acquisition is the stuff we actually have to go get (or build).

---

## Integration

### Make `protected_lane_fraction` part of the query

This column is filled in for every route (range 0 to 1.0, average 0.41, and 109 of 149 are above zero). It's probably the single most useful number for someone who's nervous about traffic, and right now there's no way to ask for it.

Where it lives: `RouteSearchConstraints` in `route-search-types.ts`, the LLM constraint extraction step, and the `WHERE` clause in `db-client.ts` (`findNearestRoutes`).

Done when a query like "safe route away from cars" applies a `protected_lane_fraction >= X` filter.

### Make `greenway_fraction` part of the query

Same idea, same plumbing. Populated everywhere, 0 to 1.0, average 0.24, 68 routes above zero. Covers the "off-street, away from cars" intent that we can't serve today.

Done when "greenway" or "off-street" maps to a `greenway_fraction >= X` filter.

### Make `facility_coverage_fraction` part of the query

Again same pattern. Filled in for all 149, average 0.70. It's the broad "how much of this is on any kind of bike infrastructure" signal.

Done when it's filterable through the same constraint mechanism as the two above.

### Filter distance in SQL, not through the embedding

This one's a correctness fix, not a tuning knob. Magnitudes don't embed in any meaningful way — "under 10 km" routed through a vector is basically noise. Distance should be a plain SQL comparison (`<=`, `>=`, `BETWEEN`) on `distance_km`. The values run from 1.9 km to 115.7 km, so there's real range to work with.

Some of this already exists: `findNearestRoutes` takes `minKm` and `maxKm`. The gap is the extraction step reliably filling them in.

A note for whoever picks up the four tasks above: they're all the same shape. Pull a structured constraint out of the query, apply it as a SQL predicate, and let the embedding handle only the fuzzy part — "scenic," "quiet," "waterfront." Build the constraint pipeline once and these four become rows in it rather than four separate features. Distance is the cleanest example to start from since the scaffolding's already there.

Done when "short flat ride" produces a `distance_km <=` filter that runs alongside the vector ranking.

### Rewrite the descriptions, then re-embed

This is the root cause of the 21-distinct-strings problem. Regenerate each description from the fields we actually have — name, distance, the three fractions above, network, loop-or-not — and re-run embeddings afterward. The current text is built almost entirely on the three columns that are mostly empty (surface, steepness, elevation), which is why it falls back to "not specified" so often.

Worth doing alongside the constraint work, since the better descriptions are what make the semantic half of search any good.

Done when we've got roughly 149 distinct, useful descriptions, re-embedded, with before/after checks on a handful of real queries.

### Tag each route with a borough

Routes have no borough field at all. But every route has a `start_point` geometry, and the `facility_segments` table already carries borough labels across 23,807 segments (Brooklyn, Manhattan, Queens, Bronx, Staten Island). A spatial join gets us a borough on every route.

Location is how most people actually search for a ride ("something in Brooklyn"), and we can't answer that today.

Done when routes have a borough, exposed as a filter and worked into the description.

### Surface network tier and route shape

A few smaller things that are sitting unused. `network` tells us local vs regional vs national cycle route (lcn 100, ncn 11, rcn 11), which is a real quality difference. `is_loop` is set on 29 routes. `tags.out_and_back` flags 18, and `tags.variant` flags another 18 that are variants of a base route — which is the start of an "alternative routes" feature if we want it.

Good task to parallelize since the pieces are independent.

Done when these show up in descriptions and filters, and variants can be linked to each other.

---

## Acquisition

### Backfill steepness and surface

`surface_breakdown`, `steepness_breakdown`, `ascent_m`, and `descent_m` are only present on about 23 to 25 of the 149 routes. So roughly 85% missing. This is a real gap, not a wiring problem.

First question to answer: did we ever run OSM enrichment for these? The `osm_way_ids` column is populated, so the link back to OSM is there — it looks like the per-way `surface` and grade tags just never got fetched or aggregated upstream. My guess is a skipped or failed enrichment step in the corpus pipeline rather than anything missing at the source.

Two ways to fill it:
- Re-run OSM tag enrichment over the `osm_way_ids` we already have and aggregate `surface` / `smoothness`.
- Pull elevation from a DEM (SRTM or USGS) along the route geometry and compute ascent, descent, and steepness ourselves. That path doesn't depend on OSM tagging being complete.

This belongs upstream in the corpus pipeline, not in this app. Once it's done, the rewritten descriptions can actually mention surface and hills.

Done when coverage on those four fields goes from ~15% to a clear majority.

### Pull in nearby places and points of interest

For each route, fetch what's near the line — landmarks, scenic spots, somewhere to stop for water or coffee, things worth a detour. Google's Places / geospatial APIs are the obvious source.

This is what turns a line on a map into an actual ride someone wants to take ("greenway loop, couple of coffee stops, waterfront view"). It also gives the descriptions and embeddings a lot more to work with.

Things to sort out before committing: API cost and quota, caching the results in our own table so we're not calling live on every search, and how often to refresh. Store it structured so we can both show it and fold it into the text.

Done when routes carry a cached set of nearby POIs, shown in the detail panel and used in the description.

### Make search a conversation

This one's a feature, not a data task — flagging that so it doesn't get lumped in with the backfill work. Right now search is one shot: type a query, get results, start over. Better would be a back-and-forth where someone searches, sees a few candidates, and then refines in plain language — "flatter," "make it a loop," "add a coffee stop," "5 km longer." And the assistant can push back or offer things on its own ("there's a more protected version of this, want it?").

The reason it fits well with the constraint work above: in a multi-turn setup, the LLM handles the vibe and the structured filters get re-applied each turn, so a refinement is just a re-rank instead of a fresh search.

This depends on the integration tasks landing first. The conversation is only as good as the fields it has to talk about, so it's worth doing after the descriptions and constraints are in. Build-wise it needs conversation state, streaming, and a loop that re-derives the SQL predicates between turns.

Done when someone can shape a route over a few messages and the assistant suggests real, data-backed options.

---

## Rough ownership

- Search / backend: the four constraint tasks. Do these first since everything leans on the pipeline.
- Data / pipeline: description rewrite plus re-embed, and the borough join. The rewrite pairs naturally with the constraint work.
- Upstream pipeline: steepness and surface backfill. Figure out the root cause before building anything.
- Integrations: the Places enrichment. Keep an eye on API cost and cache aggressively.
- Full-stack / AI: conversational search, once the integration tasks are in.
- Anyone with spare cycles: network tier and route shape — small and independent.
