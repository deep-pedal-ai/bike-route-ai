import express from 'express';
import { routesRouter } from './routes/routes.js';
import { corpusRouter } from './routes/corpus.js';
import { errorHandler } from './middleware/error-handler.js';

export const app = express();

app.use(express.json());
app.use('/api/routes', routesRouter);
app.use('/api/corpus', corpusRouter);

// Central error middleware MUST be registered last, after all routes.
app.use(errorHandler);
