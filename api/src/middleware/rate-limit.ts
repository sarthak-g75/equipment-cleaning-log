import rateLimit, { type Options } from 'express-rate-limit';
import { config } from '../config';
import { AppError } from '../lib/errors';

class RateLimitError extends AppError {
  readonly statusCode = 429;
  constructor() {
    super('RATE_LIMITED', 'Too many requests. Please try again later.');
  }
}

const handler: Options['handler'] = (_req, _res, next) => next(new RateLimitError());

/**
 * Tight limit on credential submission. Without it, the login endpoint is an
 * offline-speed password oracle: bcrypt slows a single guess, not a million of
 * them across a botnet.
 *
 * Counted per IP in this process's memory. That is correct for a single
 * instance and wrong the moment the API is scaled horizontally, where the store
 * has to move to Redis — noted in NOTES.md rather than pretended away.
 */
export const authRateLimiter = rateLimit({
  windowMs: config.rateLimit.authWindowMs,
  limit: config.rateLimit.authMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Successful logins should not consume the budget, so a busy legitimate user
  // is never locked out by their own activity.
  skipSuccessfulRequests: true,
  handler,
  // The suite would otherwise fail on whichever test happens to run eleventh.
  skip: () => config.isTest,
});

/** A broad ceiling on everything else, to blunt scraping and accidental loops. */
export const globalRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip: () => config.isTest,
});
