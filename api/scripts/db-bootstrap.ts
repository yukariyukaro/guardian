import { createDatabase } from '../src/infrastructure/database/client.js';
import { migrateDatabase } from '../src/infrastructure/database/maintenance.js';
import { PostgresArchiveRepository } from '../src/modules/archive/infrastructure/postgres-archive-repository.js';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write('db:bootstrap unexecuted: DATABASE_URL is required.\n');
  process.exitCode = 1;
} else if ((process.env.NODE_ENV ?? '').toLowerCase() === 'production') {
  process.stderr.write('db:bootstrap refused in production; use the explicit reviewed migration step.\n');
  process.exitCode = 1;
} else {
  const database = createDatabase(connectionString);
  try {
    // Explicit development bootstrap applies tracked migrations and checks the read repository.
    // It does not create a database, roles, fictional regions, review records or content rows.
    await migrateDatabase(database.pool);
    if (!await new PostgresArchiveRepository(database.pool).isReady()) throw new Error('Database not ready');
    process.stdout.write('Database bootstrap passed; migrations applied, no content seeded.\n');
  } catch {
    process.stderr.write('Database bootstrap failed; no connection details are logged.\n');
    process.exitCode = 1;
  } finally {
    try { await database.close(); } catch { process.exitCode = 1; }
  }
}
