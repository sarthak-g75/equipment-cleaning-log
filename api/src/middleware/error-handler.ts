import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError, ConflictError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: ReadonlyArray<{ field: string; message: string }>;
  };
}

/**
 * Maps the handful of Prisma failures that are genuinely *operational* (the
 * client asked for something impossible) onto our error hierarchy. Anything
 * else stays a programming error and becomes a 500.
 */
function translatePrismaError(error: unknown): AppError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;

  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return new ConflictError('DUPLICATE_VALUE', `A record with that ${target} already exists.`);
    }
    case 'P2003':
      return new ConflictError(
        'FOREIGN_KEY_VIOLATION',
        'The request references a related record that does not exist.',
      );
    case 'P2025':
      return new NotFoundError('Record', 'requested');
    default:
      return null;
  }
}

/**
 * The single place an error becomes an HTTP response. Route handlers and
 * services just throw; Express 5 forwards rejected promises from handlers here
 * on its own, which is why there is no asyncHandler wrapper in this codebase.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = error instanceof AppError ? error : translatePrismaError(error);

  if (appError) {
    const body: ErrorBody = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
      },
    };
    res.status(appError.statusCode).json(body);
    return;
  }

  // Programming error: log everything we have, tell the client nothing. The
  // request id ties this line to the response the user saw.
  logger.error({ err: error, reqId: req.id }, 'unhandled error');

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  } satisfies ErrorBody);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `Cannot ${req.method} ${req.path}` },
  } satisfies ErrorBody);
}
