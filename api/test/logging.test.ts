import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { InstitutionRepository } from '../src/modules/archive/domain/institution.js';

// All sentinels below are synthetic. Real bodies, tokens, IPs, and user identities are forbidden fixtures.
test('structured logs correlate request ids but omit queries, bodies, identity headers and error contents', async () => {
  let output = '';
  let publicRequestId: unknown;
  const repository: InstitutionRepository = {
    mode: 'mock', isReady: async () => true,
    list: async () => { throw new Error('ERROR_SECRET_SENTINEL SQL connectionString'); },
    findBySlug: async () => null,
  };
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test' }), institutionRepository: repository,
    logStream: { write(message) { output += message; } },
  });
  try {
    const result = await app.inject({
      method: 'GET', url: '/api/v1/public/institutions?q=QUERY_SECRET_SENTINEL',
      headers: {
        'x-request-id': 'safe-request_1', authorization: 'Bearer TOKEN_SECRET_SENTINEL',
        cookie: 'session=COOKIE_SECRET_SENTINEL', 'user-agent': 'IDENTITY_SECRET_SENTINEL',
      },
    });
    publicRequestId = result.headers['x-request-id'];
    await app.inject({
      method: 'POST', url: '/api/v1/public/corrections?unknown=URL_SECRET_SENTINEL',
      payload: { message: 'BODY_SECRET_SENTINEL' },
    });
  } finally { await app.close(); }

  assert.doesNotMatch(output, /SECRET_SENTINEL|connectionString|authorization|cookie|user-agent|remoteAddress|remotePort|hostname|\.ts:\d/);
  const lines = output.trim().split('\n').map((line) => JSON.parse(line));
  const completed = lines.find((line) => line.msg === 'request completed' && line.request_id === publicRequestId);
  assert.ok(completed);
  assert.equal(completed.method, 'GET');
  assert.equal(completed.route, '/api/v1/public/institutions');
  assert.equal(completed.status_code, 500);
  assert.equal(typeof completed.duration_ms, 'number');
  assert.ok(lines.some((line) => line.error_code === 'INTERNAL_ERROR'));
});
