import { pino } from 'pino';
import { config } from '../config';

/**
 * Structured JSON logs, because a production log has to be queryable by an
 * aggregator — `console.log` string interpolation is not.
 *
 * Redaction is configured globally rather than left to each call site: relying
 * on every future caller to remember not to log a token is how credentials end
 * up in a log aggregator.
 */
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      '*.password',
      '*.passwordHash',
      'token',
      '*.token',
    ],
    censor: '[redacted]',
  },
  // Pretty output is a development convenience only; production emits raw JSON
  // so nothing has to parse ANSI escapes back out.
  ...(config.isProduction || config.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
  // Tests would otherwise interleave log output with the reporter.
  enabled: !config.isTest,
});
