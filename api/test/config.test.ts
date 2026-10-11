import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { generateRequestId } from '../src/http/observability.js';

test('safe local defaults do not require a database, secret, or external service', () => {
  assert.deepEqual(loadConfig({}), {
    nodeEnv: 'development',
    host: '127.0.0.1',
    port: 3001,
    logLevel: 'info',
    dataAdapter: 'mock',
  });
});

test('production refuses mock and never falls back from postgres', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /Mock data is forbidden/);
  assert.equal(loadConfig({ NODE_ENV: 'production', DATA_ADAPTER: 'postgres' }).dataAdapter, 'postgres');
  assert.throws(() => loadConfig({ DATA_ADAPTER: 'unknown' }), /DATA_ADAPTER/);
});

test('configuration rejects invalid or ambiguous port values', () => {
  for (const port of ['0', '65536', '1.5', 'abc', '', '3e3']) {
    assert.throws(() => loadConfig({ PORT: port }), /PORT/);
  }
});

test('request ids are bounded and untrusted malformed values are replaced', () => {
  assert.match(generateRequestId({ headers: { 'x-request-id': 'test-request_1' } }), /^[0-9a-f-]{36}$/);
  for (const value of ['a'.repeat(121), '\r\nforged', ['duplicate', 'header'], 'with spaces']) {
    const id = generateRequestId({ headers: { 'x-request-id': value } });
    assert.match(id, /^[0-9a-f-]{36}$/);
  }
});
