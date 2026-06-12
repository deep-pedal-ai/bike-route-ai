export interface Route {
  id: string;
  name: string;
  distance: number; // km
  waypoints: [number, number][]; // [lat, lng]
}

export interface RouteRequest {
  origin: string;
  destination: string;
}

export interface RouteResponse {
  routes: Route[];
}

export type RouteSearchRequest = {
  query: string;
};

export type RouteSearchResult = {
  id: string;
  name: string;
  distanceKm: number;
  ascentM: number | null;
  isLoop: boolean;
  qualityScore: number | null;
  surfaceBreakdown: Record<string, number> | null;
  blurb: string;
};

export type RouteSearchResponse = {
  results: RouteSearchResult[];
  filtersRelaxed: boolean;
};

export type ErrorResponse = {
  error: string;
  statusCode: number;
};

// Corpus map-tab contract (new — does not modify the AI-gen types above).
export * from './corpus.js';
