import { app } from '../packages/server/src/app.js';

const REQUIRED_ENV_VARS = ['OPENAI_API_KEY', 'DATABASE_URL'] as const;
const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

export default app;
