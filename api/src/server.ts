import { createApp } from './app';
import { config } from './config';
import { prisma } from './database/prisma';
import { logger } from './lib/logger';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'API listening');
});

let isShuttingDown = false;

/**
 * Drain in-flight requests before dropping the database connection, so a deploy
 * or a `docker compose down` does not fail requests that were already accepted.
 *
 * The timer is the backstop: if a request hangs, the orchestrator's SIGKILL
 * would otherwise be the only thing that ends the process, and it would end it
 * far less cleanly.
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      // Keep-alive sockets hold the server open even with no active request, so
      // close() alone can stall until the client happens to disconnect.
      server.closeIdleConnections?.();
    });
    await prisma.$disconnect();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/**
 * A programming error has left the process in an unknown state. Log it, then
 * exit and let the supervisor start a clean one — continuing risks serving
 * requests from corrupted state, which is worse than a restart.
 */
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  void shutdown('uncaughtException').finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  void shutdown('unhandledRejection').finally(() => process.exit(1));
});
