import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

test('shared public budget returns contract 429 and resets without retaining client identity', async () => {
  let now = 1_000;
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }), logger: false,
    requestBudget: { max: 2, windowMs: 5_000, now: () => now } });
  try {
    assert.equal((await app.inject('/api/v1/public/metadata')).statusCode, 200);
    assert.equal((await app.inject('/api/v1/public/sources')).statusCode, 200);
    const limited = await app.inject('/api/v1/public/institutions');
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, 'RATE_LIMITED');
    assert.equal(limited.headers['retry-after'], '5');
    assert.equal((await app.inject('/health/live')).statusCode, 200);
    now += 5_000;
    assert.equal((await app.inject('/api/v1/public/institutions')).statusCode, 200);
  } finally { await app.close(); }
});

test('numeric parameters are decimal integers before Ajv coercion and details never echo unknown names', async () => {
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }), logger: false });
  try {
    for (const value of ['1e2', '0x10', '1.0', '+1', ' 1', '', 'Infinity']) {
      const result = await app.inject(`/api/v1/public/sources?${new URLSearchParams({ page: value })}`);
      assert.equal(result.statusCode, 400, value);
    }
    const unknown = await app.inject('/api/v1/public/metadata?PRIVATE_FIELD_SENTINEL=PRIVATE_VALUE_SENTINEL');
    assert.equal(unknown.statusCode, 400);
    assert.doesNotMatch(unknown.body, /PRIVATE_FIELD_SENTINEL|PRIVATE_VALUE_SENTINEL/);
  } finally { await app.close(); }
});
