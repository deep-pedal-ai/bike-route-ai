import pg from 'pg';

// Lazy singleton pg.Pool. The connection string carries `sslmode=require`, which
// node-postgres honours via the connectionString alone (Neon's cert is valid), so
// no separate `ssl` config object is needed.
//
// Read-only seam: this pool is only ever used to SELECT from the corpus tables.
//
// The connection string is process.env.DATABASE_URL. Integration tests point the
// pool at the Neon test branch by assigning DATABASE_URL = TEST_DATABASE_URL at the
// top of the test file (the pool is lazy, so that lands before the first query);
// the runtime/dev server always uses DATABASE_URL as-is.
let pool: pg.Pool | null = null;

const resolveConnectionString = (): string => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.');
  }
  return connectionString;
};

export const getPool = (): pg.Pool => {
  if (pool === null) {
    pool = new pg.Pool({ connectionString: resolveConnectionString() });
  }
  return pool;
};

// Parameterized query helper over the singleton pool. Generic defaults to the
// single-column JSON row each corpus query returns ({ result: <json> }).
export const query = async <Row extends pg.QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<pg.QueryResult<Row>> => {
  return getPool().query<Row>(text, params as unknown[]);
};

// Close the pool (used by integration-test afterAll). Resets the singleton so a
// subsequent getPool() rebuilds it.
export const closePool = async (): Promise<void> => {
  if (pool !== null) {
    await pool.end();
    pool = null;
  }
};
