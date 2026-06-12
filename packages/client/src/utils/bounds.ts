import type { FeatureCollection, LineString } from 'geojson';

// Computes the bounding box of every coordinate across a LineString
// FeatureCollection. Coordinates are [lng, lat] (EPSG:4326) and stay in that
// order — returned as MapLibre's `[[west, south], [east, north]]` corner pair.
// Generic over the feature properties so callers needn't widen the props type.
export function fitBoundsFromFeatures<P>(
  fc: FeatureCollection<LineString, P>,
): [[number, number], [number, number]] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const feature of fc.features) {
    for (const [lng, lat] of feature.geometry.coordinates) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }

  return [
    [west, south],
    [east, north],
  ];
}
