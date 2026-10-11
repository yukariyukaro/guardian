import type { FastifyPluginAsync } from 'fastify';

/** Empty by design. Future routes require a private network and verified service identity. */
export const internalPartition: FastifyPluginAsync = async (_app) => {
  // No intake, webhooks, workers, uploads, or external-service adapters.
};
