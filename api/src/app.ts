import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { apiRouter } from './routes';
import { healthRouter } from './modules/health/health.routes';
import { requestLogger } from './middleware/request-logger';
import { globalRateLimiter } from './middleware/rate-limit';
import { errorHandler, notFoundHandler } from './middleware/error-handler';

/**
 * Builds the app without calling listen(), so supertest can mount it directly
 * and the e2e suite needs no real port.
 *
 * Middleware order is deliberate: logging first so every request is recorded
 * including ones later middleware rejects, then the security headers, then the
 * rate limiter (before body parsing, so an abusive client is turned away before
 * we spend memory parsing its payload).
 */
export function createApp(): Express {
  const app = express();

  // Rate limiting and request logs are only correct behind a proxy if Express
  // trusts its forwarding headers — otherwise every client shares the proxy's IP.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: false }));
  app.use(globalRateLimiter);
  app.use(express.json({ limit: '100kb' }));

  app.use('/health', healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
