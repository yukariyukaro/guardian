import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { loadContract } from '../src/infrastructure/openapi/contract.js';
import { createFictionalRecords } from '../src/modules/archive/infrastructure/fixtures.js';
import { InMemoryInstitutionRepository } from '../src/modules/archive/infrastructure/in-memory-institution-repository.js';
import type { InstitutionRepository, PublicInstitution } from '../src/modules/archive/domain/institution.js';

async function withApp(run: (app: FastifyInstance) => Promise<void>, repository?: InstitutionRepository): Promise<void> {
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test' }), logger: false,
    ...(repository ? { institutionRepository: repository } : {}),
  });
  try { await run(app); } finally { await app.close(); }
}

test('app factory rejects a manually supplied production/mock configuration', async () => {
  await assert.rejects(buildApp({
    config: { ...loadConfig({}), nodeEnv: 'production' }, logger: false,
  }), /Mock data is forbidden/);
});

test('health distinguishes local mock readiness from database connectivity', async () => {
  await withApp(async (app) => {
    const live = await app.inject('/health/live');
    assert.equal(live.statusCode, 200);
    assert.deepEqual(live.json(), { status: 'alive' });
    const ready = await app.inject('/health/ready');
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { status: 'ready', mode: 'mock', database: 'disabled', public_repository: 'ready' });
  });
});

test('postgres skeleton stays unavailable with no database access and no mock fallback', async () => {
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', DATA_ADAPTER: 'postgres' }), logger: false });
  try {
    assert.equal((await app.inject('/health/live')).statusCode, 200);
    for (const path of ['/health/ready', '/api/v1/public/institutions', '/api/v1/public/institutions/fictional-mist-harbor-center']) {
      const result = await app.inject(path);
      assert.equal(result.statusCode, 503);
      assert.deepEqual(result.json(), { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable', details: [] } });
      assert.doesNotMatch(result.body, /postgres|database|connection|password|mock/i);
    }
  } finally { await app.close(); }
});

test('list and detail use canonical fictional contract data and explicit public projection', async () => {
  await withApp(async (app) => {
    const result = await app.inject({ url: '/api/v1/public/institutions', headers: { 'x-request-id': 'test-request_1' } });
    assert.equal(result.statusCode, 200);
    assert.match(String(result.headers['x-request-id']), /^[0-9a-f-]{36}$/);
    assert.notEqual(result.headers['x-request-id'], 'test-request_1');
    assert.equal(result.headers['cache-control'], 'no-store');
    const body = result.json();
    assert.deepEqual(body.pagination, { page: 1, page_size: 20, total: 1, total_pages: 1 });
    assert.equal(body.data[0].slug, 'fictional-mist-harbor-center');
    assert.match(body.data[0].name, /虚构/);
    assert.deepEqual(Object.keys(body.data[0]).sort(), [
      'aliases', 'evidence_status', 'last_reviewed_at', 'name', 'operating_status', 'public_summary',
      'region', 'risk_tags', 'slug', 'source_count', 'updated_at',
    ].sort());
    assert.doesNotMatch(result.body, /internalId|internalNotes|publicationState|00000000|private note|request_id/);
    const detail = await app.inject(`/api/v1/public/institutions/${body.data[0].slug}`);
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(detail.json(), { data: body.data[0] });
  });
});

test('draft, hidden, withdrawn, and missing records return indistinguishable 404 responses', async () => {
  await withApp(async (app) => {
    let expected: unknown;
    for (const slug of ['fictional-draft', 'fictional-temporarily-hidden', 'fictional-withdrawn', 'fictional-does-not-exist']) {
      const result = await app.inject(`/api/v1/public/institutions/${slug}`);
      assert.equal(result.statusCode, 404);
      assert.equal(result.json().error.code, 'NOT_FOUND');
      expected ??= result.json();
      assert.deepEqual(result.json(), expected);
      assert.doesNotMatch(result.body, /DRAFT|HIDDEN|WITHDRAWN|00000000|internal/i);
    }
  });
});

test('pagination, pure-text alias search, AND filters, empty results, and out-of-range pages follow contract', async () => {
  await withApp(async (app) => {
    const query = new URLSearchParams({
      q: '  雾港旧称  ', region: 'fictional-mist-region', risk_tag: 'regulatory_action',
      evidence_status: 'official_record', operating_status: 'unknown', sort: 'name_asc', page_size: '1',
    });
    const result = await app.inject(`/api/v1/public/institutions?${query}`);
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().data.length, 1);
    assert.equal(result.json().pagination.page_size, 1);

    for (const suffix of ['q=nonexistent', 'risk_tag=fee_dispute', 'operating_status=closed', 'q=%3Cscript%3E']) {
      const empty = await app.inject(`/api/v1/public/institutions?${suffix}`);
      assert.equal(empty.statusCode, 200);
      assert.deepEqual(empty.json(), { data: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 } });
    }
    const beyond = await app.inject('/api/v1/public/institutions?page=2&page_size=1');
    assert.deepEqual(beyond.json(), { data: [], pagination: { page: 2, page_size: 1, total: 1, total_pages: 1 } });
  });
});

test('invalid, repeated, unknown, and visibility override query parameters fail closed', async () => {
  await withApp(async (app) => {
    for (const query of [
      'page=0', 'page=1000001', 'page=1.5', 'page_size=0', 'page_size=51', 'page_size=abc',
      'page=1&page=2', 'q=a&q=a', 'visibility=PUBLISHED', 'unknown=SECRET_SENTINEL',
      'region=fictional-unknown-region', 'risk_tag=invalid', 'evidence_status=invalid', 'sort=invalid',
      `q=${'a'.repeat(101)}`,
    ]) {
      const result = await app.inject(`/api/v1/public/institutions?${query}`);
      assert.equal(result.statusCode, 400, query);
      const body = result.json();
      assert.equal(body.error.code, 'VALIDATION_ERROR');
      assert.ok(Array.isArray(body.error.details));
      assert.doesNotMatch(result.body, /SECRET_SENTINEL|fictional-unknown-region|stack|sql/i);
      assert.ok(result.headers['x-request-id']);
    }
    assert.equal((await app.inject('/api/v1/public/institutions/InvalidSlug')).statusCode, 400);
    assert.equal((await app.inject('/api/v1/public/institutions/fictional-mist-harbor-center?visibility=PUBLISHED')).statusCode, 400);
  });
});

test('write/intake/upload/admin/internal routes are not enabled', async () => {
  await withApp(async (app) => {
    for (const [method, url] of [
      ['POST', '/api/v1/public/institutions'], ['POST', '/api/v1/public/corrections'],
      ['POST', '/api/v1/intake/submissions'], ['POST', '/api/v1/public/uploads'],
      ['GET', '/api/v1/admin/institutions'], ['GET', '/api/v1/internal/intake/email'],
      ['POST', '/api/v1/internal/intake/github'],
    ] as const) {
      const result = await app.inject({ method, url });
      assert.equal(result.statusCode, 404);
      assert.equal(result.json().error.code, 'NOT_FOUND');
    }
  });
});

test('unexpected adapter errors are generic and never return internals', async () => {
  const repository: InstitutionRepository = {
    mode: 'mock', isReady: async () => true,
    list: async () => { throw new Error('SECRET_SENTINEL SELECT password FROM submissions'); },
    findBySlug: async () => null,
  };
  await withApp(async (app) => {
    const result = await app.inject('/api/v1/public/institutions');
    assert.equal(result.statusCode, 500);
    assert.deepEqual(result.json(), { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: [] } });
    assert.doesNotMatch(result.body, /SECRET_SENTINEL|SELECT|submissions|password|stack/);
  }, repository);
});

test('runtime response validation blocks unexpected private fields and invalid DTOs', async () => {
  const base = createFictionalRecords(loadContract())[0]!.reviewedProjection;
  for (const invalid of [
    { ...base, internal_notes: 'SECRET_SENTINEL' },
    { ...base, updated_at: 'invalid' },
    { ...base, region: { ...base.region, address: 'SECRET_SENTINEL' } },
  ]) {
    const repository: InstitutionRepository = {
      mode: 'mock', isReady: async () => true,
      list: async () => ({ data: [invalid as PublicInstitution], pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 } }),
      findBySlug: async () => invalid as PublicInstitution,
    };
    await withApp(async (app) => {
      for (const url of ['/api/v1/public/institutions', '/api/v1/public/institutions/fictional-mist-harbor-center']) {
        const result = await app.inject(url);
        assert.equal(result.statusCode, 500);
        assert.equal(result.json().error.code, 'INTERNAL_ERROR');
        assert.doesNotMatch(result.body, /SECRET_SENTINEL|internal_notes|address/);
      }
    }, repository);
  }
});

test('projection mapping discards extra fields before runtime serialization', async () => {
  const records = createFictionalRecords(loadContract());
  const projected = records[0]!.reviewedProjection as PublicInstitution & { internal_notes?: string };
  projected.internal_notes = 'SECRET_SENTINEL';
  const repository = new InMemoryInstitutionRepository(records);
  await withApp(async (app) => {
    const result = await app.inject('/api/v1/public/institutions');
    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(result.body, /SECRET_SENTINEL|internal_notes|internalNotes|internalId/);
  }, repository);
});
