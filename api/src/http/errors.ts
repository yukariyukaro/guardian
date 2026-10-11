import type { FastifyError, FastifyInstance } from 'fastify';
import { ApiError, type ErrorCode, type ErrorDetail } from '../shared/errors.js';
import type { components } from '../infrastructure/openapi/generated.js';
import { operationSchema, type JsonObject } from '../infrastructure/openapi/contract.js';

const PUBLIC_FIELDS = new Set(['page', 'page_size', 'q', 'region', 'risk_tag', 'evidence_status', 'operating_status', 'sort', 'slug', 'id', 'institution_slug', 'source_type']);
function safeField(field: unknown): string {
  if (typeof field !== 'string') return 'request';
  const normalized = field.replace(/^\//, '');
  return PUBLIC_FIELDS.has(normalized) ? normalized : 'request';
}

export function registerErrorHandling(app: FastifyInstance, contract: JsonObject): void {
  const listSchema = operationSchema(contract, '/api/v1/public/institutions');
  const errorSchema = (listSchema.response as Record<string, unknown>)['400'];
  if (!errorSchema) throw new Error('The shared contract must define a 400 error schema');

  app.addHook('onRoute', (route) => {
    route.schema ??= {};
    const responses = route.schema.response ?? {};
    route.schema.response = {
      400: errorSchema,
      404: errorSchema,
      429: errorSchema,
      500: errorSchema,
      503: errorSchema,
      ...responses,
    };
  });

  app.setNotFoundHandler(async () => {
    throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found');
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    let status = 500;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: ErrorDetail[] = [];

    if (error instanceof ApiError) {
      status = error.statusCode;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (error.validation) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'The request does not satisfy the API contract';
      details = error.validation.map((issue) => ({
        field: safeField(issue.params.missingProperty ?? issue.params.additionalProperty ?? issue.instancePath),
        message: 'Invalid or unsupported value',
      }));
    } else if (error.statusCode === 400 || error.statusCode === 413 || error.statusCode === 415) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'The request could not be processed';
    } else if (error.statusCode === 429) {
      status = 429;
      code = 'RATE_LIMITED';
      message = 'Too many requests';
    }

    if (status >= 500) {
      request.log.error({ error_code: code, status_code: status }, 'request failed');
    }
    const body: components['schemas']['ErrorResponse'] = { error: { code, message, details } };
    reply.code(status).send(body);
  });
}
