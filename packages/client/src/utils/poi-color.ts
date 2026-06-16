// POI pin colour encoding. One distinct colour per POI bucket, tuned to read on
// the cream Voyager basemap and to stay distinct from the route/facility
// palettes so the POI layer reads as its own thing. The icon system (colour +
// shape per bucket) carries most of the visual richness since most POIs have no
// image (feature doc §2a). Pure — no React, no MapLibre import.

import type { PoiBucket } from '@bike-route-ai/shared';

const POI_COLORS: Record<PoiBucket, string> = {
  coffee_food: '#8a4b2f', // roasted coffee — cafés, bakeries, food
  water_rest: '#2f7d9a', // spring water — drinking water, rest, parks
  scenic: '#3f8f4e', // overlook green — viewpoints, peaks, waterfalls
  landmark: '#9a5fb0', // heritage violet — historic / culture
  bike_services: '#c4602b', // clay — bike repair / shops
};

const DEFAULT_POI_COLOR: string = '#5c5f52'; // lichen stone — unknown bucket

export function poiColor(bucket: string): string {
  return POI_COLORS[bucket as PoiBucket] ?? DEFAULT_POI_COLOR;
}
