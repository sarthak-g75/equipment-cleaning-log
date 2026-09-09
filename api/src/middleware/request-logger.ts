import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger';

/**
 * An inbound correlation id is attacker-controlled input that we are about to
 * write into a response header and every log line for the request. Anything
 * outside this shape is discarded in favour of a fresh id, so a caller cannot
 * inject newlines into the log stream, smuggle a header, or bloat every log
 * line with a megabyte of text.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * One log line per request, carrying a correlation id.
 *
 * The id is echoed back as `x-request-id`, which is what makes it possible to
 * take a user's bug report and find the exact request in the logs. An inbound
 * id is honoured so the correlation survives a proxy or an upstream service.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const inbound = req.headers['x-request-id'];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    const id = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  // Expected client errors are not operational failures of this service, so
  // they must not page anyone at `error` level.
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  // The default serializers log entire req/res objects, which is noisy and is
  // also how headers end up in logs by accident.
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  autoLogging: {
    // Health probes fire every few seconds; logging them buries real traffic.
    ignore: (req) => req.url === '/health/live' || req.url === '/health/ready',
  },
});
