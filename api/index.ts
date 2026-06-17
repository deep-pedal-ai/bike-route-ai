import { app } from '../packages/server/src/app.js';

const REQUIRED_ENV_VARS = ['OPENAI_API_KEY', 'DATABASE_URL'] as const;
const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[env] Missing required environment variables: ${missing.join(', ')}`);
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

for (const key of REQUIRED_ENV_VARS) {
  console.log(`[env] ${key}: set (length=${process.env[key]!.length})`);
}

export default app;
