import dotenv from 'dotenv';
dotenv.config();

import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { apiRouter } from './routes/api';
import { HttpError } from './services/actions';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[azure-janitor] unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  const mode = process.env.MOCK_MODE === 'true' ? 'MOCK' : 'LIVE';
  console.log(`[azure-janitor] API listening on http://localhost:${port} (${mode} mode)`);
});
