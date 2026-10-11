import type { FastifyInstance } from 'fastify';
import type { DataAdapter } from '../../config.js';
import { ApiError } from '../../shared/errors.js';

export interface ReadinessProbe {
  readonly mode: DataAdapter;
  isReady(): Promise<boolean>;
}

const liveSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { const: 'alive' } },
};
const readySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'mode', 'database', 'public_repository'],
  properties: {
    status: { const: 'ready' },
    mode: { enum: ['mock', 'postgres'] },
    database: { enum: ['disabled', 'connected'] },
    public_repository: { const: 'ready' },
  },
};

export function registerHealthRoutes(app: FastifyInstance, probe: ReadinessProbe): void {
  app.get('/health/live', { schema: { response: { 200: liveSchema } } }, async () => ({ status: 'alive' }));

  app.get('/health/ready', { schema: { response: { 200: readySchema } } }, async () => {
    if (!await probe.isReady()) {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable');
    }
    return {
      status: 'ready',
      mode: probe.mode,
      database: probe.mode === 'mock' ? 'disabled' : 'connected',
      public_repository: 'ready',
    };
  });
}
