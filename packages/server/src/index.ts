import 'dotenv/config';

import OpenAI from 'openai';
import { Pool } from 'pg';
import { app } from './app.js';

const REQUIRED_ENV_VARS = ['OPENAI_API_KEY', 'DATABASE_URL'] as const;

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

async function probeDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('SELECT 1');
    console.log('[env] DATABASE_URL: connection OK');
  } catch (err) {
    console.warn('[env] DATABASE_URL: connection failed — key may be stale or credentials revoked:', (err as Error).message);
  } finally {
    await pool.end();
  }
}

async function probeOpenAI(): Promise<void> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    await client.models.list();
    console.log('[env] OPENAI_API_KEY: connection OK');
  } catch (err) {
    console.warn('[env] OPENAI_API_KEY: connection failed — key may be stale or revoked:', (err as Error).message);
  }
}

const PORT = process.env.PORT ?? 3000;

await Promise.all([probeDatabase(), probeOpenAI()]);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
