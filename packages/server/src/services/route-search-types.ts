import type { RouteSearchResponse } from '@bike-route-ai/shared';

export const EMBEDDING_MODEL_NAME = 'text-embedding-3-small';
export const EMBEDDING_MODEL_ID = `openai:${EMBEDDING_MODEL_NAME}`;
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4.1-mini';
export const MAX_SEARCH_QUERY_LENGTH = 500;
// Slice 1 has only NY; an absent region falls back to it so existing callers
// keep working while the partition is wired end-to-end.
export const DEFAULT_REGION = 'ny';

export type RouteSearchConstraints = {
  minKm?: number;
  maxKm?: number;
  isLoop?: boolean;
};

export type RouteSearchCandidate = {
  id: string;
  name: string;
  distanceKm: number;
  ascentM: number | null;
  isLoop: boolean;
  qualityScore: number | null;
  surfaceBreakdown: Record<string, number> | null;
  description: string;
};

export type RouteSearchRerank = {
  id: string;
  blurb: string;
};

export type RouteSearchAiClient = {
  extractConstraints(query: string): Promise<RouteSearchConstraints>;
  embedQuery(query: string): Promise<number[]>;
  rerank(query: string, candidates: RouteSearchCandidate[]): Promise<RouteSearchRerank[]>;
};

export type RouteSearchDbClient = {
  assertEmbeddingModel(expectedModelId: string): Promise<void>;
  // `region` is a SEPARATE parameter from `constraints` on purpose: the service's
  // no-results path retries with relaxed (empty) constraints, and region must
  // survive that relaxation so a query in one metro never ranks another metro's
  // routes (multi-region partition invariant).
  findNearestRoutes(
    embedding: number[],
    constraints: RouteSearchConstraints,
    limit: number,
    region: string,
  ): Promise<RouteSearchCandidate[]>;
};

export type RouteSearchService = {
  search(query: string, region?: string): Promise<RouteSearchResponse>;
};
