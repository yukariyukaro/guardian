import type { FastifyInstance } from 'fastify';
import { ApiError } from '../shared/errors.js';

export interface RequestBudgetOptions { max: number; windowMs: number; now?: () => number }

/** A shared per-process budget retains no IP, UA, cookie, token, or query information. */
export function registerRequestBudget(app: FastifyInstance, options: RequestBudgetOptions): void {
  const now = options.now ?? Date.now;
  let start = now();
  let remaining = options.max;
  app.addHook('onRequest', async (_request, reply) => {
    const time = now();
    if (time < start || time - start >= options.windowMs) { start = time; remaining = options.max; }
    if (remaining === 0) {
      reply.header('retry-after', String(Math.max(1, Math.ceil((start + options.windowMs - time) / 1000))));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
    }
    remaining -= 1;
  });
}
