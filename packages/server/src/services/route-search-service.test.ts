import { describe, expect, it } from 'vitest';
import { createRouteSearchService } from './route-search-service.js';
import { EMBEDDING_MODEL_ID } from './route-search-types.js';
import type {
  RouteSearchAiClient,
  RouteSearchCandidate,
  RouteSearchConstraints,
  RouteSearchDbClient,
  RouteSearchRerank,
} from './route-search-types.js';

const CANDIDATES: RouteSearchCandidate[] = [
  {
    id: 'greenway',
    name: 'Greenway Loop',
    distanceKm: 20,
    ascentM: 80,
    isLoop: true,
    qualityScore: 0.92,
    surfaceBreakdown: { paved: 1 },
    description: 'A flat paved greenway loop away from traffic.',
  },
  {
    id: 'ridge',
    name: 'Ridge Gravel',
    distanceKm: 34,
    ascentM: 650,
    isLoop: true,
    qualityScore: 0.81,
    surfaceBreakdown: { gravel: 0.7, paved: 0.3 },
    description: 'A hilly mixed-surface route with gravel climbing.',
  },
];

describe('route search service', () => {
  it('returns reranked DB facts with filters preserved', async () => {
    const aiClient = createFakeAiClient({
      constraints: { minKm: 15, maxKm: 25, isLoop: true },
      rankings: [{ id: 'greenway', blurb: 'Matches the flat protected loop request.' }],
    });
    const dbClient = createFakeDbClient([CANDIDATES]);
    const service = createRouteSearchService(aiClient, dbClient);

    const response = await service.search('flat protected loop around 20 km');

    expect(dbClient.assertedModelIds).toEqual([EMBEDDING_MODEL_ID]);
    expect(dbClient.calls).toEqual([
      {
        embedding: [0.1, 0.2, 0.3],
        constraints: { minKm: 15, maxKm: 25, isLoop: true },
        limit: 5,
        region: 'ny',
      },
    ]);
    expect(response.filtersRelaxed).toBe(false);
    expect(response.results[0]).toMatchObject({
      id: 'greenway',
      name: 'Greenway Loop',
      distanceKm: 20,
      ascentM: 80,
      isLoop: true,
      blurb: 'Matches the flat protected loop request.',
    });
  });

  it('reruns without filters when hard constraints return no candidates', async () => {
    const aiClient = createFakeAiClient({
      constraints: { minKm: 300, maxKm: 330, isLoop: true },
      rankings: [{ id: 'ridge', blurb: 'Closest available longer loop.' }],
    });
    const dbClient = createFakeDbClient([[], [CANDIDATES[1]]]);
    const service = createRouteSearchService(aiClient, dbClient);

    const response = await service.search('200 mile loop');

    expect(response.filtersRelaxed).toBe(true);
    expect(dbClient.calls.map((call) => call.constraints)).toEqual([
      { minKm: 300, maxKm: 330, isLoop: true },
      {},
    ]);
    expect(response.results).toHaveLength(1);
    expect(response.results[0].id).toBe('ridge');
  });

  it('keeps the region on BOTH the constrained and the relaxed query (partition invariant)', async () => {
    const aiClient = createFakeAiClient({
      constraints: { minKm: 300, maxKm: 330, isLoop: true },
      rankings: [{ id: 'ridge', blurb: 'Closest available longer loop.' }],
    });
    // First (constrained) call returns nothing → relax path fires.
    const dbClient = createFakeDbClient([[], [CANDIDATES[1]]]);
    const service = createRouteSearchService(aiClient, dbClient);

    await service.search('200 mile loop in the city', 'ny');

    // Region must be present on EVERY call — the relax path drops constraints,
    // not the region, so a query never ranks another metro's routes.
    expect(dbClient.calls.map((call) => call.region)).toEqual(['ny', 'ny']);
  });

  it('defaults the region to ny when the caller omits it', async () => {
    const aiClient = createFakeAiClient({ constraints: {}, rankings: [] });
    const dbClient = createFakeDbClient([CANDIDATES]);
    const service = createRouteSearchService(aiClient, dbClient);

    await service.search('quiet ride');

    expect(dbClient.calls[0].region).toBe('ny');
  });

  it('falls back to cosine order when rerank returns an out-of-set id', async () => {
    const aiClient = createFakeAiClient({
      constraints: {},
      rankings: [{ id: 'unknown', blurb: 'Invalid route.' }],
    });
    const dbClient = createFakeDbClient([CANDIDATES]);
    const service = createRouteSearchService(aiClient, dbClient);

    const response = await service.search('quiet ride');

    expect(response.results.map((result) => result.id)).toEqual(['greenway', 'ridge']);
    expect(response.results.map((result) => result.blurb)).toEqual([
      CANDIDATES[0].description,
      CANDIDATES[1].description,
    ]);
  });

  it('falls back to stored descriptions when rerank fails', async () => {
    const aiClient = createFakeAiClient({
      constraints: {},
      rerankError: new Error('model unavailable'),
    });
    const dbClient = createFakeDbClient([CANDIDATES]);
    const service = createRouteSearchService(aiClient, dbClient);

    const response = await service.search('gravel climbing');

    expect(response.results.map((result) => result.blurb)).toEqual([
      CANDIDATES[0].description,
      CANDIDATES[1].description,
    ]);
  });
});

type FakeAiClientOptions = {
  constraints: RouteSearchConstraints;
  rankings?: RouteSearchRerank[];
  rerankError?: Error;
};

function createFakeAiClient(options: FakeAiClientOptions): RouteSearchAiClient {
  return {
    async extractConstraints(): Promise<RouteSearchConstraints> {
      return options.constraints;
    },
    async embedQuery(): Promise<number[]> {
      return [0.1, 0.2, 0.3];
    },
    async rerank(): Promise<RouteSearchRerank[]> {
      if (options.rerankError) {
        throw options.rerankError;
      }
      return options.rankings ?? [];
    },
  };
}

type DbCall = {
  embedding: number[];
  constraints: RouteSearchConstraints;
  limit: number;
  region: string;
};

type FakeDbClient = RouteSearchDbClient & {
  assertedModelIds: string[];
  calls: DbCall[];
};

function createFakeDbClient(candidateResponses: RouteSearchCandidate[][]): FakeDbClient {
  const calls: DbCall[] = [];
  const assertedModelIds: string[] = [];

  return {
    assertedModelIds,
    calls,
    async assertEmbeddingModel(expectedModelId: string): Promise<void> {
      assertedModelIds.push(expectedModelId);
    },
    async findNearestRoutes(
      embedding: number[],
      constraints: RouteSearchConstraints,
      limit: number,
      region: string,
    ): Promise<RouteSearchCandidate[]> {
      calls.push({ embedding, constraints, limit, region });
      return candidateResponses[calls.length - 1] ?? [];
    },
  };
}
