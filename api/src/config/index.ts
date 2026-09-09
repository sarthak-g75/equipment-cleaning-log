import 'dotenv/config';
import { z } from 'zod';

/**
 * The single place `process.env` is read. Parsed once at startup so a missing or
 * malformed variable fails the process immediately with a readable message,
 * rather than surfacing as a confusing runtime error on the third request.
 */
const envSchema = z.object({
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
