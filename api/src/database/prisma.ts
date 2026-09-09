import { PrismaClient } from '@prisma/client';
import { config } from '../config';

/**
 * One client for the process. Prisma manages its own connection pool; creating
 * a client per request would exhaust Postgres connections under any real load.
 */
export const prisma = new PrismaClient({
  log: config.isTest ? [] : ['warn', 'error'],
});
