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
  // Optional read partition key (e.g. 'ny'); keeps search results in-metro.
  region?: string;
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

// Chat streaming contract. The client POSTs a ChatRequest and consumes a
// text/event-stream whose frames correspond to the ChatStreamEvent variants
// below (token deltas, a terminal done, or a generic error).
export type ChatRequest = {
  query: string;
};

export type ChatStreamEvent =
  | { type: 'token'; value: string }
  | { type: 'done' }
  | { type: 'error'; error: string };

// Corpus map-tab contract (new — does not modify the AI-gen types above).
export * from './corpus.js';
