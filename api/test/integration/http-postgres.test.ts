import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { validateIntegrationTargets } from '../support/integration-target.js';

test('all seven HTTP reads use the real PostgreSQL adapter and close its owned pool', async () => {
  const { readonlyUrl: connectionString } = validateIntegrationTargets(process.env);
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', DATA_ADAPTER: 'postgres', DATABASE_URL: connectionString }), logger: false });
  try {
    const ready = await app.inject('/health/ready');
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().database, 'connected');
    for (const path of [
      '/institutions', '/institutions/fictional-mist-harbor-center',
      '/institutions/fictional-mist-harbor-center/timeline',
      '/institutions/fictional-mist-harbor-center/sources',
      '/sources', '/sources/src-fictional-demo-notice', '/metadata',
    ]) {
      const response = await app.inject(`/api/v1/public${path}`);
      assert.equal(response.statusCode, 200, path);
      assert.doesNotMatch(response.body, /internalId|internal_notes|postgresql:\/\/|publicationState/);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    for (const path of ['/institutions/fictional-draft', '/sources/src-fictional-withdrawn', '/institutions/fictional-withdrawn/timeline']) {
      assert.equal((await app.inject(`/api/v1/public${path}`)).statusCode, 404);
    }
    assert.equal((await app.inject('/api/v1/public/sources?page=1e2')).statusCode, 400);
    assert.equal((await app.inject('/api/v1/public/metadata?unknown=synthetic')).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/public/sources' })).statusCode, 404);
  } finally { await app.close(); }
  await app.close();
});
