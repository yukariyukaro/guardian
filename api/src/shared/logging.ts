import type { FastifyServerOptions } from 'fastify';
import type { LogLevel } from '../config.js';

export interface LogStream { write(message: string): void }

/** No raw URL/query, body, IP, UA, authentication headers, or internal error messages. */
export function createLoggerOptions(level: LogLevel, stream?: LogStream): Exclude<FastifyServerOptions['logger'], undefined> {
  return {
    level,
    base: null,
    ...(stream ? { stream } : {}),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body',
        'req.query',
        'res.headers["set-cookie"]',
        'password',
        'token',
        'connectionString',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req: (request) => ({ method: request.method }),
      res: (reply) => ({ status_code: reply.statusCode }),
      err: () => ({ type: 'Error', message: '[REDACTED]', stack: '' }),
    },
  };
}
