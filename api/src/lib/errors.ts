/**
 * Operational errors carry the status code and a stable machine-readable `code`
 * that clients branch on. Anything thrown that is NOT an AppError is treated as
 * a programming error by the error middleware: logged with its stack, and
 * reported to the client as a bare 500 with no internals.
 */
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  readonly isOperational = true;

  protected constructor(
    readonly code: string,
    message: string,
    readonly details?: ReadonlyArray<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  readonly statusCode = 400;
  constructor(
    code: string,
    message: string,
    details?: ReadonlyArray<{ field: string; message: string }>,
  ) {
    super(code, message, details);
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400;
  constructor(details: ReadonlyArray<{ field: string; message: string }>) {
    super('VALIDATION_ERROR', 'The request payload failed validation.', details);
  }
}

export class UnauthorizedError extends AppError {
  readonly statusCode = 401;
  constructor(message = 'Authentication is required.') {
    super('UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  readonly statusCode = 403;
  constructor(message = 'You do not have permission to perform this action.') {
    super('FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  readonly statusCode = 404;
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} '${id}' was not found.`);
  }
}

export class ConflictError extends AppError {
  readonly statusCode = 409;
  constructor(code: string, message: string) {
    super(code, message);
  }
}
