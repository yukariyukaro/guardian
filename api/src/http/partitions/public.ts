import type { FastifyPluginAsync } from 'fastify';
import type { JsonObject } from '../../infrastructure/openapi/contract.js';
import type { ArchiveService } from '../../modules/archive/application/institution-service.js';
import { registerArchiveRoutes } from '../../modules/archive/routes.js';
import { registerRequestBudget, type RequestBudgetOptions } from '../request-budget.js';

export function publicPartition(contract: JsonObject, service: ArchiveService, budget: RequestBudgetOptions): FastifyPluginAsync {
  return async (app) => {
    registerRequestBudget(app, budget);
    registerArchiveRoutes(app, contract, service);
  };
}
