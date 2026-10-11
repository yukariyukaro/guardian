import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

/** Explicit pool factory. Composition root owns lifecycle; migrations never run here. */
export function createDatabase(connectionString: string) {
  if (!connectionString.trim()) {
    throw new Error('A PostgreSQL connection string is required');
  }

  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
    query_timeout: 5_000,
    statement_timeout: 5_000,
  });

  // Prevent unhandled idle-client driver errors. Readiness/reads still fail closed;
  // intentionally do not log driver errors, connection strings, SQL or parameters.
  pool.on('error', () => {});

  let closing: Promise<void> | undefined;

  return {
    pool,
    db: drizzle(pool, { schema }),
    async isReady(): Promise<boolean> {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    close: (): Promise<void> => { closing ??= pool.end(); return closing; },
  };
}
