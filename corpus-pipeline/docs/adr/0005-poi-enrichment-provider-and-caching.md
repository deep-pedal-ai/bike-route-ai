---
status: accepted
---

# POI enrichment: provider, caching, and basemap

Freewheel returns routes from a **fixed, pre-built corpus** (149 canon routes,
retrieved by semantic search — never generated per query). To make a line on the
map feel like a ride worth taking, each route should surface nearby points of
interest (POIs): coffee, water, scenic overlooks, landmarks, bike services. This
ADR locks **where POI data comes from** and **what we are allowed to store** —
the two questions that gate every downstream design choice.

> **On the Google ToS specifics below:** these are stated as the *conservative
> reading* of the Google Maps Platform terms, pending a point-in-time
> verification against the current published terms. The **decision is robust to
> the exact details** — under any plausible reading the caching and basemap
> restrictions hold, so we don't use Google Places regardless. Verify the precise
> clauses before citing this ADR in a contractual or billing context.

The tempting source is **Google Places** (photos, ratings, editorial blurbs).
Two of its Terms-of-Service constraints collide with our architecture:

1. **Caching.** Google Places forbids persisting most Place fields; you may store
   `place_id` long-term and must re-fetch the rest (name, rating, photos,
   geometry) at display time. Our acceptance criterion is the opposite — *cache
   in our own table, no live calls on the search path.*
2. **Basemap.** Google Places content may only be displayed *on a Google map*. We
   render on **MapLibre GL** (OpenStreetMap tiles). Pinning Places data on a
   non-Google basemap is a ToS violation, not a gray area.

The decisive insight: **the caching constraint survives a basemap switch.** Even
if we migrated the client from MapLibre to Google Maps (a multi-day rebuild of
`MapExplorer.tsx`'s entire source/layer system, plus recurring billing and a
mandatory credit card), we would *still* be barred from caching Place fields and
forced into live, per-view hydration. The basemap buys legal *display*, never a
clean static cache. So Google does not actually solve our problem at any price we
were willing to pay.

**Decision:** POIs are sourced **OSM-canonical**:

- **OpenStreetMap / Overpass** (already a pipeline dependency) is the canonical,
  **fully cacheable** POI layer. It populates our own `pois` table, renders
  legally on MapLibre, and feeds the embedding. Cost: $0.
- **Wikidata / Wikimedia Commons** supplies images. Many notable POIs carry a
  `wikidata` tag in OSM; the linked image is **freely licensed and storable**
  (we store the URL + license + attribution, never a blob — see
  [`poi-enrichment-feature.md`](../../../docs/poi-enrichment-feature.md)).
- **Google Maps** appears only as an **outbound deep-link**
  (`google.com/maps/search/?api=1&query=LAT,LNG`), derived on the frontend from
  geometry. A link stores no Google data, needs no account, and breaks no terms.

**Why:** this keeps the cache truly static (search path stays a pure DB read),
stays legal on the existing MapLibre basemap, costs nothing, and still delivers
~80% of the "comprehensive and smart" payoff (real POIs, images, one-tap to
Google Maps). It avoids taking on a recurring bill, a credit-card-gated billing
account, a key-rotation burden, and a multi-day frontend migration — none of
which would have removed the caching restriction anyway.

**Consequence:** Google Places remains a **deferred, reversible** option. The
POI provider is isolated behind phase p6's fetch step and a config-driven
category whitelist, so swapping or layering in Places later is a contained
change — *if and only if* the team also accepts a Google basemap and live
per-view hydration. The trigger to revisit is a product decision that photo/
rating richness is worth that tax; until then, OSM + Wikimedia is the baseline.

**Note on a possible future rework:** the category-level POI summary is folded
into `description` inside the deterministic `build_route_description()` (Phase 5).
If a teammate later replaces that builder with an LLM-written description, that
function is the **single coupling point** to preserve — the LLM prompt must still
receive the selected POI categories so the embedding stays POI-aware. No other
part of the runtime retrieval path touches POIs.
