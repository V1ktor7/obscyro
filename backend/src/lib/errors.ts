export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const NotFound = (code: string, message: string, details?: unknown): AppError =>
  new AppError(code, message, 404, details);

export const BadRequest = (code: string, message: string, details?: unknown): AppError =>
  new AppError(code, message, 400, details);

export const Conflict = (code: string, message: string, details?: unknown): AppError =>
  new AppError(code, message, 409, details);

export const InternalError = (code: string, message: string, details?: unknown): AppError =>
  new AppError(code, message, 500, details);

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function envelope(err: AppError): ErrorEnvelope {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  };
}
