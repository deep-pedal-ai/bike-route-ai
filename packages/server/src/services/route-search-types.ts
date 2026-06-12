import type { RouteSearchResponse } from '@bike-route-ai/shared';

export const EMBEDDING_MODEL_NAME = 'text-embedding-3-small';
export const EMBEDDING_MODEL_ID = `openai:${EMBEDDING_MODEL_NAME}`;
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4.1-mini';
export const MAX_SEARCH_QUERY_LENGTH = 500;

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
  findNearestRoutes(
    embedding: number[],
    constraints: RouteSearchConstraints,
    limit: number,
  ): Promise<RouteSearchCandidate[]>;
};

export type RouteSearchService = {
  search(query: string): Promise<RouteSearchResponse>;
};
