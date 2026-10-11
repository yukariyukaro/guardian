import { createDatabase } from '../src/infrastructure/database/client.js';
import { loadContract } from '../src/infrastructure/openapi/contract.js';
import { createArchiveFixtures } from '../src/modules/archive/infrastructure/fixtures.js';
import { seedSyntheticDatabase } from '../src/infrastructure/database/maintenance.js';

const connectionString = process.env.DATABASE_URL?.trim();
const environment = (process.env.NODE_ENV ?? '').toLowerCase();
if (!connectionString) {
  process.stderr.write('db:synthetic-seed unexecuted: DATABASE_URL is required.\n');
  process.exitCode = 1;
} else if (environment === 'production') {
  process.stderr.write('db:synthetic-seed refused in production.\n');
  process.exitCode = 1;
} else {
  const database = createDatabase(connectionString);
  try {
    const fixtures = createArchiveFixtures(loadContract());
    await seedSyntheticDatabase(database.pool, fixtures, environment);
    process.stdout.write(`Synthetic seed applied insert-only: ${fixtures.institutions.length} institutions, ${fixtures.sources.length} sources, ${fixtures.timeline.length} events.\n`);
  } catch {
    process.stderr.write('Synthetic seed failed; no connection details are logged.\n');
    process.exitCode = 1;
  } finally {
    try { await database.close(); } catch { process.exitCode = 1; }
  }
}
