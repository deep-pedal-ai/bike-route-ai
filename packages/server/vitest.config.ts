import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Load packages/server/.env before any test imports db.ts, so integration
    // tests (and subagent test runs) see DATABASE_URL / TEST_DATABASE_URL.
    setupFiles: ['dotenv/config'],
    coverage: {
      provider: 'v8',
      reporter: ['json-summary', 'json'],
      include: ['src/**/*.ts'],
      // db.ts is pure connection plumbing (a pg.Pool from an env var) exercised
      // only via integration tests; exclude it so it never drags coverage down.
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/db.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
