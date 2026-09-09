import { createApp } from './app';
import { config } from './config';
import { prisma } from './database/prisma';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} [${config.env}]`);
});

/**
 * Drain in-flight requests before dropping the DB connection, so a deploy or a
 * `docker compose down` doesn't fail requests that were already accepted.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
