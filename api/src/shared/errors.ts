import type { components } from '../infrastructure/openapi/generated.js';

export type ErrorCode = components['schemas']['ErrorCode'];
export type ErrorDetail = components['schemas']['ErrorDetail'];

/** Only deliberately safe messages belong in errors returned to public clients. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
