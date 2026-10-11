import type { FastifyPluginAsync } from 'fastify';

/** Empty by design. Add private authentication/authorization before registering any route. */
export const adminPartition: FastifyPluginAsync = async (_app) => {
  // No CRUD, login, or submission handlers are enabled in this skeleton.
};
