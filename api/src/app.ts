import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { loadConfig, type ApiConfig } from './config.js';
import { registerErrorHandling } from './http/errors.js';
import { generateRequestId, registerObservability } from './http/observability.js';
import { registerValidation } from './http/validation.js';
import { adminPartition } from './http/partitions/admin.js';
import { internalPartition } from './http/partitions/internal.js';
import { publicPartition } from './http/partitions/public.js';
import { loadContract } from './infrastructure/openapi/contract.js';
import { ArchiveService } from './modules/archive/application/institution-service.js';
import type { ArchiveRepository } from './modules/archive/domain/archive.js';
import { createDatabase } from './infrastructure/database/client.js';
import { PostgresArchiveRepository } from './modules/archive/infrastructure/postgres-archive-repository.js';
import type { RequestBudgetOptions } from './http/request-budget.js';
import type { InstitutionRepository } from './modules/archive/domain/institution.js';
import { createFictionalRecords } from './modules/archive/infrastructure/fixtures.js';
import { InMemoryInstitutionRepository } from './modules/archive/infrastructure/in-memory-institution-repository.js';
import { UnavailablePostgresInstitutionRepository } from './modules/archive/infrastructure/unavailable-postgres-institution-repository.js';
import { archiveManifest } from './modules/archive/manifest.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { createLoggerOptions, type LogStream } from './shared/logging.js';

export interface AppOptions {
  readonly config?: ApiConfig;
  readonly logger?: false;
  readonly logStream?: LogStream;
  /** Explicit DI seam for synthetic tests and the future real adapter. Never automatic fallback. */
  readonly institutionRepository?: InstitutionRepository;
  readonly archiveRepository?: ArchiveRepository;
  readonly requestBudget?: RequestBudgetOptions;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  if (config.nodeEnv === 'production' && config.dataAdapter === 'mock') {
    throw new Error('Mock data is forbidden in production');
  }
  const contract = loadContract();
  const database = !options.archiveRepository && !options.institutionRepository
    && config.dataAdapter === 'postgres' && config.databaseUrl ? createDatabase(config.databaseUrl) : undefined;
  const baseRepository: ArchiveRepository = options.archiveRepository ?? (config.dataAdapter === 'mock'
    ? new InMemoryInstitutionRepository(createFictionalRecords(contract))
    : database ? new PostgresArchiveRepository(database.pool) : new UnavailablePostgresInstitutionRepository());
  const institution = options.institutionRepository;
  const repository: ArchiveRepository = institution ? {
    mode: institution.mode,
    isReady: () => institution.isReady(),
    list: (query) => institution.list(query),
    findBySlug: (slug) => institution.findBySlug(slug),
    listSources: (query) => baseRepository.listSources(query),
    findSourceById: (id) => baseRepository.findSourceById(id),
    listInstitutionSources: (slug, query) => baseRepository.listInstitutionSources(slug, query),
    listTimeline: (slug, query) => baseRepository.listTimeline(slug, query),
    metadata: () => baseRepository.metadata(),
  } : baseRepository;
  if (repository.mode !== config.dataAdapter) {
    throw new Error('Configured adapter and repository mode do not match');
  }

  const app = Fastify({
    logger: options.logger === false ? false : createLoggerOptions(config.logLevel, options.logStream),
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'request_id' }),
    requestIdHeader: false,
    genReqId: generateRequestId,
    trustProxy: false,
    bodyLimit: 16_384,
    return503OnClosing: true,
  });

  registerValidation(app);
  registerObservability(app);
  registerErrorHandling(app, contract);
  registerHealthRoutes(app, repository);
  const budget = options.requestBudget ?? { max: 600, windowMs: 60_000 };
  if (!Number.isSafeInteger(budget.max) || budget.max < 1 || !Number.isSafeInteger(budget.windowMs) || budget.windowMs < 1) {
    await database?.close();
    throw new Error('Invalid public request budget');
  }
  if (database) app.addHook('onClose', async () => { await database.close(); });
  app.register(publicPartition(contract, new ArchiveService(repository), budget), { prefix: archiveManifest.apiNamespace });
  app.register(adminPartition, { prefix: '/api/v1/admin' });
  app.register(internalPartition, { prefix: '/api/v1/internal' });
  try {
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    await database?.close();
    throw error;
  }
}
