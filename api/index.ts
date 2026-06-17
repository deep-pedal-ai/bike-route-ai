import OpenAI from 'openai';
import pg from 'pg';
import { app } from '../packages/server/src/app.js';

const REQUIRED_ENV_VARS = ['OPENAI_API_KEY', 'DATABASE_URL'] as const;

// Log each var on its own line — combined messages get truncated in Vercel logs
for (const key of REQUIRED_ENV_VARS) {
  if (process.env[key]) {
    console.log(`[env] ${key}: set (length=${process.env[key]!.length})`);
  } else {
    console.error(`[env] ${key}: MISSING`);
  }
}

const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

async function probeDatabase(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('SELECT 1');
    console.log('[env] DATABASE_URL: connection OK');
  } catch (err) {
    console.warn('[env] DATABASE_URL: connection failed —', (err as Error).message);
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
    console.warn('[env] OPENAI_API_KEY: connection failed —', (err as Error).message);
  }
}

await Promise.all([probeDatabase(), probeOpenAI()]);

export default app;
