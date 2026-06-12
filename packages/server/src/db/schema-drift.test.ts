import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { routes } from './schema.js';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase('routes mirror schema drift smoke test', () => {
  it('can select through the read-side routes schema', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);

    try {
      const rows = await db
        .select({
          id: routes.id,
          name: routes.name,
          distanceKm: routes.distanceKm,
          ascentM: routes.ascentM,
          isLoop: routes.isLoop,
          surfaceBreakdown: routes.surfaceBreakdown,
          qualityScore: routes.qualityScore,
          description: routes.description,
          embeddingModel: routes.embeddingModel,
        })
        .from(routes)
        .limit(1);

      expect(Array.isArray(rows)).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
