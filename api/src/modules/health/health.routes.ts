import { Router } from 'express';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';

export const healthRouter = Router();

/**
 * Liveness: is the process itself still running and able to answer?
 *
 * Deliberately does NOT touch the database. A liveness probe that fails during
 * a database outage causes the orchestrator to kill and restart every replica,
 * turning a recoverable dependency failure into an outage of its own.
 */
healthRouter.get('/live', (_req, res) => {
  res.status(200).json({ data: { status: 'ok', uptime: process.uptime() } });
});

/**
 * Readiness: should this instance receive traffic right now?
 *
 * This one does check the database, because an instance that cannot reach
 * Postgres cannot serve a useful request and should be pulled from the load
 * balancer rather than answering with 500s.
 */
healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ data: { status: 'ok', database: 'up' } });
  } catch (error) {
    logger.error({ err: error }, 'readiness check failed');
    res.status(503).json({
      error: { code: 'NOT_READY', message: 'The service is not ready to accept traffic.' },
    });
  }
});

/** The original single probe, kept so existing checks do not break. */
healthRouter.get('/', (_req, res) => {
  res.status(200).json({ data: { status: 'ok' } });
});
