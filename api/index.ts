import { app } from '../packages/server/src/app.js';

const REQUIRED_ENV_VARS = ['OPENAI_API_KEY', 'DATABASE_URL'] as const;
for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export default app;
