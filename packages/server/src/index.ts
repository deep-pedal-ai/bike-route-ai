import 'dotenv/config';

import { app } from './app.js';

const REQUIRED_ENV_VARS = ['OPENAI_API_KEY', 'DATABASE_URL'] as const;

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
