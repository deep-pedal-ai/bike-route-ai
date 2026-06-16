import type { RouteSearchResponse, RouteSearchResult } from '@bike-route-ai/shared';
import {
  EMBEDDING_MODEL_ID,
  type RouteSearchAiClient,
  type RouteSearchCandidate,
  type RouteSearchConstraints,
  type RouteSearchDbClient,
  type RouteSearchRerank,
  type RouteSearchService,
} from './route-search-types.js';

export function createRouteSearchService(
  aiClient: RouteSearchAiClient,
  dbClient: RouteSearchDbClient,
): RouteSearchService {
  return {
    async search(query: string): Promise<RouteSearchResponse> {
      const trimmedQuery = query.trim();
      console.log(`Route search: query="${trimmedQuery}"`);

      const constraints = sanitizeConstraints(await aiClient.extractConstraints(trimmedQuery));
      console.log('Route search: extracted constraints', constraints);

      const queryEmbedding = await aiClient.embedQuery(trimmedQuery);

      await dbClient.assertEmbeddingModel(EMBEDDING_MODEL_ID);

      let filtersRelaxed = false;
      let candidates = await dbClient.findNearestRoutes(queryEmbedding, constraints, 5);

      if (candidates.length === 0 && hasHardConstraints(constraints)) {
        console.log('Route search: no results with constraints, retrying without filters');
        filtersRelaxed = true;
        candidates = await dbClient.findNearestRoutes(queryEmbedding, {}, 5);
      }

      if (candidates.length === 0) {
        console.log('Route search: no candidates found, returning empty results');
        return { results: [], filtersRelaxed };
      }

      const rankings = await getValidatedRankings(trimmedQuery, candidates, aiClient);
      const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const results = rankings
        .slice(0, 3)
        .map((ranking) => {
          const candidate = candidatesById.get(ranking.id);
          if (!candidate) return null;
          return toSearchResult(candidate, ranking.blurb);
        })
        .filter((result): result is RouteSearchResult => result !== null);

      console.log(`Route search: returning ${results.length} result(s)`);
      return { results, filtersRelaxed };
    },
  };
}

function sanitizeConstraints(constraints: RouteSearchConstraints): RouteSearchConstraints {
  const sanitized: RouteSearchConstraints = {};

  if (typeof constraints.minKm === 'number' && Number.isFinite(constraints.minKm) && constraints.minKm >= 0) {
    sanitized.minKm = constraints.minKm;
  }
  if (typeof constraints.maxKm === 'number' && Number.isFinite(constraints.maxKm) && constraints.maxKm >= 0) {
    sanitized.maxKm = constraints.maxKm;
  }
  if (
    sanitized.minKm !== undefined &&
    sanitized.maxKm !== undefined &&
    sanitized.minKm > sanitized.maxKm
  ) {
    const originalMin = sanitized.minKm;
    sanitized.minKm = sanitized.maxKm;
    sanitized.maxKm = originalMin;
  }
  if (typeof constraints.isLoop === 'boolean') {
    sanitized.isLoop = constraints.isLoop;
  }

  return sanitized;
}

function hasHardConstraints(constraints: RouteSearchConstraints): boolean {
  return constraints.minKm !== undefined || constraints.maxKm !== undefined || constraints.isLoop !== undefined;
}

async function getValidatedRankings(
  query: string,
  candidates: RouteSearchCandidate[],
  aiClient: RouteSearchAiClient,
): Promise<RouteSearchRerank[]> {
  try {
    const rankings = await aiClient.rerank(query, candidates);
    return validateRankings(rankings, candidates);
  } catch (err) {
    console.warn('Route search: rerank failed, falling back to default ranking:', err);
    return fallbackRankings(candidates);
  }
}

function validateRankings(
  rankings: RouteSearchRerank[],
  candidates: RouteSearchCandidate[],
): RouteSearchRerank[] {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const seenIds = new Set<string>();

  for (const ranking of rankings) {
    if (!candidateIds.has(ranking.id) || seenIds.has(ranking.id) || ranking.blurb.trim().length === 0) {
      return fallbackRankings(candidates);
    }
    seenIds.add(ranking.id);
  }

  if (rankings.length === 0) {
    return fallbackRankings(candidates);
  }

  const rankedIds = new Set(rankings.map((ranking) => ranking.id));
  const unranked = candidates
    .filter((candidate) => !rankedIds.has(candidate.id))
    .map((candidate) => ({ id: candidate.id, blurb: candidate.description }));

  return [...rankings, ...unranked];
}

function fallbackRankings(candidates: RouteSearchCandidate[]): RouteSearchRerank[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    blurb: candidate.description,
  }));
}

function toSearchResult(candidate: RouteSearchCandidate, blurb: string): RouteSearchResult {
  return {
    id: candidate.id,
    name: candidate.name,
    distanceKm: candidate.distanceKm,
    ascentM: candidate.ascentM,
    isLoop: candidate.isLoop,
    qualityScore: candidate.qualityScore,
    surfaceBreakdown: candidate.surfaceBreakdown,
    blurb,
  };
}
