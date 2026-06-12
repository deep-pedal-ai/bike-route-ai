import type { FilterSpecification } from 'maplibre-gl';

// Canonical client filter state for the corpus route layer. C5 (FilterBar)
// mirrors this exact shape and C7 (MapExplorer) reconciles it onto the map, so
// keep the field names byte-for-byte stable.
export type FilterState = {
  sources: string[];
  minKm?: number;
  maxKm?: number;
  loopOnly?: boolean;
  minQuality?: number;
};

// Translates filter state into a MapLibre filter expression (array form). The
// design decisions encoded here (and depended on by C5/C7):
//   - sources: []  → no source constraint (match all). An empty selection must
//     NOT blank the map; it reads as "no filter".
//   - minKm/maxKm/minQuality compare against `get`-ed props. A null property
//     value fails the numeric comparison and the feature is dropped — the sane
//     default (a route with no distance/quality can't satisfy a bound).
//   - loopOnly only constrains when true; false/undefined keeps loops AND
//     non-loops.
// Returns MapLibre's filter type so callers can pass it directly to Layer.
export function buildFilter(state: FilterState): FilterSpecification {
  const clauses: unknown[] = [];

  if (state.sources.length > 0) {
    // `['any', ['==', ['get','source'], s], …]` — a valid MapLibre *expression*.
    // (The legacy `['in', key, ...vals]` filter form mixes grammars and is not a
    // valid expression in maplibre-gl@5; the membership test is spelled as an
    // OR of equality expressions instead.)
    clauses.push(['any', ...state.sources.map((s) => ['==', ['get', 'source'], s])]);
  }

  if (state.minKm !== undefined) {
    clauses.push(['>=', ['get', 'distance_km'], state.minKm]);
  }

  if (state.maxKm !== undefined) {
    clauses.push(['<=', ['get', 'distance_km'], state.maxKm]);
  }

  if (state.loopOnly === true) {
    clauses.push(['==', ['get', 'is_loop'], true]);
  }

  if (state.minQuality !== undefined) {
    clauses.push(['>=', ['get', 'quality_score'], state.minQuality]);
  }

  return ['all', ...clauses] as FilterSpecification;
}
