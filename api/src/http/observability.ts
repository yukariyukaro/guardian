import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';

// Public clients cannot choose a persistent correlation marker for application logs.
export function generateRequestId(_request: { headers: Record<string, unknown> }): string {
  return randomUUID();
}

export function registerObservability(app: FastifyInstance): void {
  const started = new WeakMap<FastifyRequest, bigint>();

  app.addHook('onRequest', async (request, reply) => {
    started.set(request, process.hrtime.bigint());
    reply.header('x-request-id', request.id);
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.addHook('onResponse', async (request, reply) => {
    const start = started.get(request);
    const durationMs = start === undefined ? 0 : Number(process.hrtime.bigint() - start) / 1_000_000;
    request.log.info({
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      status_code: reply.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
    }, 'request completed');
  });
}
