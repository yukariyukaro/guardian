import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });
  let stopping = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
    } catch {
      app.log.error('shutdown failed');
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch {
    app.log.error('server startup failed');
    await app.close();
    process.exitCode = 1;
  }
}

main().catch(() => {
  // Do not print configuration values, database URLs, or library errors.
  process.stderr.write('API startup failed; check configuration and the shared OpenAPI contract.\n');
  process.exitCode = 1;
});
