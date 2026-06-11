import express from 'express';
import { routesRouter } from './routes/routes.js';

export const app = express();

app.use(express.json());
app.use('/api/routes', routesRouter);
