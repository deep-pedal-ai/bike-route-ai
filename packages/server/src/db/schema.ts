import { boolean, doublePrecision, jsonb, pgTable, text, vector } from 'drizzle-orm/pg-core';

// Read-side mirror only. DDL is owned by corpus-pipeline migrations; never run drizzle-kit from this app.
export const routes = pgTable('routes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // Read partition key (corpus-pipeline migration 003). NOT NULL DEFAULT 'ny'.
  region: text('region').notNull(),
  distanceKm: doublePrecision('distance_km').notNull(),
  ascentM: doublePrecision('ascent_m'),
  isLoop: boolean('is_loop').notNull(),
  surfaceBreakdown: jsonb('surface_breakdown').$type<Record<string, number> | null>(),
  qualityScore: doublePrecision('quality_score'),
  description: text('description').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  embeddingModel: text('embedding_model'),
});
