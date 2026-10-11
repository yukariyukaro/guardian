import { createDatabase } from '../src/infrastructure/database/client.js';
import { migrateDatabase } from '../src/infrastructure/database/maintenance.js';

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write('db:migrate unexecuted: DATABASE_URL is required.\n');
  process.exitCode = 1;
} else {
  const database = createDatabase(connectionString);
  try {
    await migrateDatabase(database.pool);
    process.stdout.write('Database migrations applied.\n');
  } catch {
    process.stderr.write('Database migration failed; no connection details are logged.\n');
    process.exitCode = 1;
  } finally {
    try { await database.close(); } catch { process.exitCode = 1; }
  }
}
