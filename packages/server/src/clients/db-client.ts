import { and, cosineDistance, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { routes } from '../db/schema.js';
import type {
  RouteSearchCandidate,
  RouteSearchConstraints,
  RouteSearchDbClient,
} from '../services/route-search-types.js';

export type PgRouteSearchDbClient = RouteSearchDbClient & {
  close(): Promise<void>;
};

type PgRouteSearchDbClientOptions = {
  connectionString?: string;
};

export function createPgRouteSearchDbClient(
  options: PgRouteSearchDbClientOptions = {},
): PgRouteSearchDbClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  let pool: Pool | null = null;
  let db: ReturnType<typeof drizzle> | null = null;

  function getDb(): ReturnType<typeof drizzle> {
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for route search');
    }
    if (db) {
      return db;
    }
    const newPool = new Pool({ connectionString });
    const newDb = drizzle(newPool);
    pool = newPool;
    db = newDb;
    return newDb;
  }

  return {
    async assertEmbeddingModel(expectedModelId: string): Promise<void> {
      const modelRows = await getDb()
        .select({ embeddingModel: routes.embeddingModel })
        .from(routes)
        .where(isNotNull(routes.embedding))
        .groupBy(routes.embeddingModel);

      if (modelRows.length === 0) {
        throw new Error('Route corpus has no embeddings to search');
      }

      const models = new Set(modelRows.map((row) => row.embeddingModel));
      if (models.size !== 1 || !models.has(expectedModelId)) {
        throw new Error(`Route corpus embeddings must all use ${expectedModelId}`);
      }
    },

    async findNearestRoutes(
      embedding: number[],
      constraints: RouteSearchConstraints,
      limit: number,
    ): Promise<RouteSearchCandidate[]> {
      const distance = cosineDistance(routes.embedding, embedding);
      const whereClauses: SQL[] = [isNotNull(routes.embedding)];

      if (constraints.minKm !== undefined) {
        whereClauses.push(gte(routes.distanceKm, constraints.minKm));
      }
      if (constraints.maxKm !== undefined) {
        whereClauses.push(lte(routes.distanceKm, constraints.maxKm));
      }
      if (constraints.isLoop !== undefined) {
        whereClauses.push(eq(routes.isLoop, constraints.isLoop));
      }

      const rows = await getDb()
        .select({
          id: routes.id,
          name: routes.name,
          distanceKm: routes.distanceKm,
          ascentM: routes.ascentM,
          isLoop: routes.isLoop,
          qualityScore: routes.qualityScore,
          surfaceBreakdown: routes.surfaceBreakdown,
          description: routes.description,
        })
        .from(routes)
        .where(and(...whereClauses))
        .orderBy(distance)
        .limit(limit);

      return rows;
    },

    async close(): Promise<void> {
      await pool?.end();
      pool = null;
      db = null;
    },
  };
}
