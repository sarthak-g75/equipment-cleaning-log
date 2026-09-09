import 'dotenv/config';
import { z } from 'zod';

/**
 * Secrets that ship in this repository, and therefore are public.
 *
 * Length alone is not a strength check: `dev-only-secret-change-me` is 25
 * characters and passes any `min()` you would reasonably write, while being
 * published in `.env.example` and defaulted in `docker-compose.yml`. Anyone who
 * has read the repo can mint a token for any user id and any role, because
 * `requireAuth` trusts a validly-signed token's claims. Refusing them in
 * production is the only check that actually helps.
 */
const PUBLISHED_SECRETS = new Set([
  'dev-only-secret-change-me',
  'test-secret-at-least-16-chars',
  'change-me',
  'secret',
]);

/**
 * The single place `process.env` is read. Parsed once at startup so a missing or
 * malformed variable fails the process immediately with a readable message,
 * rather than surfacing as a confusing runtime error on the third request.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    JWT_EXPIRES_IN: z.string().default('15m'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Hops to trust for X-Forwarded-For. 0 = direct exposure, 1 = one proxy. */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    /** Requests per window per IP against the auth endpoints. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && PUBLISHED_SECRETS.has(env.JWT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message:
          'refusing to start: this JWT_SECRET is published in the repository. ' +
          'Set a real secret, e.g. `openssl rand -base64 48`.',
      });
    }

    // `*` with credentials disabled is legal but almost never intended on a
    // service that hands out bearer tokens; make it a deliberate choice rather
    // than something a missing variable falls into.
    if (env.NODE_ENV === 'production' && env.CORS_ORIGIN === '*') {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'refusing to start: CORS_ORIGIN must name real origins in production, not "*".',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${problems}`);
}

const env = parsed.data;

export const config = Object.freeze({
  env: env.NODE_ENV,
  isTest: env.NODE_ENV === 'test',
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwt: Object.freeze({
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  }),
  corsOrigin: env.CORS_ORIGIN,
  logLevel: env.LOG_LEVEL,
  trustProxy: env.TRUST_PROXY,
  rateLimit: Object.freeze({
    authMax: env.AUTH_RATE_LIMIT_MAX,
    authWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  }),
  /**
   * bcrypt cost. 12 is the production floor; 4 in tests because otherwise every
   * login in the suite spends ~250ms hashing and the suite runtime is dominated
   * by a constant we are not testing.
   */
  bcryptRounds: env.NODE_ENV === 'test' ? 4 : 12,
});
