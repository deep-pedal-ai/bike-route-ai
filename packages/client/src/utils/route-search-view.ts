import { fitBoundsFromFeatures } from './bounds';

import type { ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';
import type { CorpusRouteProps } from '@bike-route-ai/shared';

// Opacity the routes layer paints a route at. `FULL` is the layer's normal
// line-opacity (matches MapExplorer's 0.95); `DIM` fades the routes the user is
// not pointing at so the hovered one reads as highlighted.
export const FULL_OPACITY = 0.95;
export const DIM_OPACITY = 0.15;

// The casing (the dark outline under each route) has its own base opacity. It
// dims harder than the line so a hovered route reads as clearly lifted above
// the others, not just slightly brighter.
export const CASING_FULL_OPACITY = 0.72;
export const CASING_DIM_OPACITY = 0.08;

// The bounding box of the single route whose id matches `id`, or null when no
// loaded feature carries that id — which, for the map layer, means the route
// has no geometry (search can return metadata-only routes). Callers treat null
// as "not mappable": no zoom, no detail. Both sides of the id comparison are
// normalized to string (the corpus layer stores `properties.id` as a number,
// search results carry it as a string — see buildIdFilter for the full hazard).
export function boundsForRouteId(
  fc: FeatureCollection<LineString, CorpusRouteProps>,
  id: number | string,
): [[number, number], [number, number]] | null {
  const target = String(id);
  const matches = fc.features.filter(
    (feature) => String(feature.properties.id) === target,
  );
  if (matches.length === 0) {
    return null;
  }
  return fitBoundsFromFeatures({ type: 'FeatureCollection', features: matches });
}

// line-opacity value for a route layer given the currently hovered route id
// (already string-normalized by the caller, or null when nothing is hovered).
//   - null      → a uniform `full` opacity (no highlight in play).
//   - '<id>'    → a `case` expression: the hovered route at `full`, every other
//     route dimmed to `dim`. The feature side is normalized with `to-string` so
//     a string hovered id matches a numeric feature id.
// `full`/`dim` default to the line values; the casing layer passes its own pair
// so it can dim harder. Returns a bare number for the uniform case (a valid
// paint value) and an expression otherwise; line-opacity accepts either.
export function routeOpacityExpression(
  hoveredId: string | null,
  full: number = FULL_OPACITY,
  dim: number = DIM_OPACITY,
): number | ExpressionSpecification {
  if (hoveredId === null) {
    return full;
  }
  return [
    'case',
    ['==', ['to-string', ['get', 'id']], hoveredId],
    full,
    dim,
  ] as ExpressionSpecification;
}
