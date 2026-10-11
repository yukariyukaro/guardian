import type { FastifyInstance } from 'fastify';
import { operationSchema, type JsonObject } from '../../infrastructure/openapi/contract.js';
import { ApiError } from '../../shared/errors.js';
import type { InstitutionQuery, InstitutionParams } from './domain/institution.js';
import type { SourceQuery, InstitutionSourceQuery, TimelineQuery } from './domain/archive.js';
import type { ArchiveService } from './application/institution-service.js';

export function registerArchiveRoutes(app: FastifyInstance, contract: JsonObject, service: ArchiveService): void {
  app.addHook('preValidation', async (request) => {
    const query = request.query as Record<string, unknown>;
    if (Object.values(query).some(Array.isArray)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Repeated query parameters are not supported');
    }
    for (const field of ['page', 'page_size']) {
      const value = query[field];
      if (value !== undefined && (typeof value !== 'string' || !/^[0-9]+$/.test(value))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'The request does not satisfy the API contract', [{ field, message: 'A decimal integer is required' }]);
      }
    }
  });
  const schema = (path: string) => operationSchema(contract, `/api/v1/public${path}`);
  app.get<{ Querystring: InstitutionQuery }>('/institutions', { schema: schema('/institutions') }, async (request) => service.list(request.query));
  app.get<{ Params: InstitutionParams }>('/institutions/:slug', { schema: schema('/institutions/{slug}') }, async (request) => service.detail(request.params.slug));
  app.get<{ Params: InstitutionParams; Querystring: TimelineQuery }>('/institutions/:slug/timeline', { schema: schema('/institutions/{slug}/timeline') }, async (request) => service.timeline(request.params.slug, request.query));
  app.get<{ Params: InstitutionParams; Querystring: InstitutionSourceQuery }>('/institutions/:slug/sources', { schema: schema('/institutions/{slug}/sources') }, async (request) => service.institutionSources(request.params.slug, request.query));
  app.get<{ Querystring: SourceQuery }>('/sources', { schema: schema('/sources') }, async (request) => service.listSources(request.query));
  app.get<{ Params: { id: string } }>('/sources/:id', { schema: schema('/sources/{id}') }, async (request) => service.source(request.params.id));
  app.get('/metadata', { schema: schema('/metadata') }, async () => service.metadata());
}
