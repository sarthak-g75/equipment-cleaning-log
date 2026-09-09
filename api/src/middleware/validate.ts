import type { NextFunction, Request, Response } from 'express';
import { z, type ZodType } from 'zod';
import { ValidationError } from '../lib/errors';

export interface RequestSchemas {
  readonly params?: ZodType;
  readonly query?: ZodType;
  readonly body?: ZodType;
}

/**
 * Parsed input is attached to `res.locals.validated` rather than written back
 * over `req.query`/`req.params`. In Express 5 those are getter-only, and
 * mutating them is exactly the kind of thing that breaks on a minor upgrade.
 */
export interface ValidatedRequest<P = unknown, Q = unknown, B = unknown> {
  readonly params: P;
  readonly query: Q;
  readonly body: B;
}

export function validated<P = unknown, Q = unknown, B = unknown>(
  res: Response,
): ValidatedRequest<P, Q, B> {
  return res.locals.validated as ValidatedRequest<P, Q, B>;
}

const toDetails = (error: z.ZodError) =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

/**
 * Validation runs as middleware, before the controller. A route that reads an
 * unvalidated `req.body` field is a bug, not a shortcut — the controller should
 * only ever see input that has already been parsed into its declared type.
 */
export function validate(schemas: RequestSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const details: { field: string; message: string }[] = [];
    const output: Record<string, unknown> = { params: {}, query: {}, body: {} };

    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (result.success) {
        output[key] = result.data;
      } else {
        details.push(
          ...toDetails(result.error).map((d) => ({
            ...d,
            field: `${key}.${d.field}`,
          })),
        );
      }
    }

    if (details.length > 0) {
      next(new ValidationError(details));
      return;
    }

    res.locals.validated = output;
    next();
  };
}
