import rateLimit, { MemoryStore, type Options } from 'express-rate-limit';
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
 * The stores are held explicitly rather than left implicit so they can be
 * cleared between tests. They live for the lifetime of the process, so without
 * a reset one spec's failed logins spend the next spec's budget — which is how
 * a limiter test ends up asserting whatever the previous file left behind.
 */
const authStore = new MemoryStore();
const globalStore = new MemoryStore();

/**
 * The limiters are off during tests by default: the suite would otherwise fail
 * on whichever spec happens to run eleventh. A runtime toggle rather than an
 * environment variable, because `config` reads the environment once at import
 * time and a spec cannot set a variable before its own imports are hoisted.
 */
let enabledInTest = false;

const isDisabled = (): boolean => config.isTest && !enabledInTest;

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
  store: authStore,
  windowMs: config.rateLimit.authWindowMs,
  limit: config.rateLimit.authMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Successful logins should not consume the budget, so a busy legitimate user
  // is never locked out by their own activity.
  skipSuccessfulRequests: true,
  handler,
  skip: isDisabled,
});

/** A broad ceiling on everything else, to blunt scraping and accidental loops. */
export const globalRateLimiter = rateLimit({
  store: globalStore,
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip: isDisabled,
});

/**
 * Test-only: run the limiters for this spec, so the one security control the
 * suite used to skip entirely is actually covered.
 */
export function setRateLimitEnabledForTests(enabled: boolean): void {
  enabledInTest = enabled;
}

/**
 * Test-only: drops every counter, so specs cannot inherit each other's budget.
 *
 * `resetAll` is async — the store interface allows a networked backend like
 * Redis — so this has to be awaited. Dropping the promise made the reset
 * fire-and-forget and the next spec's first request racy.
 */
export async function resetRateLimiters(): Promise<void> {
  await Promise.all([authStore.resetAll(), globalStore.resetAll()]);
}
