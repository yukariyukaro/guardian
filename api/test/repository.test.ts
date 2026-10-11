import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContract } from '../src/infrastructure/openapi/contract.js';
import { createFictionalRecords } from '../src/modules/archive/infrastructure/fixtures.js';
import { InMemoryInstitutionRepository } from '../src/modules/archive/infrastructure/in-memory-institution-repository.js';
import type { InstitutionRecord } from '../src/modules/archive/domain/institution.js';
import { ApiError } from '../src/shared/errors.js';

function syntheticRecord(slug: string, name: string, updated: string): InstitutionRecord {
  const base = createFictionalRecords(loadContract())[0]!;
  return { ...base, reviewedProjection: { ...base.reviewedProjection, slug, name, updated_at: updated } };
}

test('stable updated/name sorting, public-only totals, and pagination use the same filtered result', async () => {
  const hidden = createFictionalRecords(loadContract()).slice(1);
  const repository = new InMemoryInstitutionRepository([
    syntheticRecord('fictional-c', '虚构C', '2026-01-02T00:00:00Z'),
    syntheticRecord('fictional-b', '虚构B', '2026-01-03T00:00:00Z'),
    syntheticRecord('fictional-a', '虚构A', '2026-01-03T00:00:00Z'),
    ...hidden,
  ]);
  const desc = await repository.list({ sort: 'updated_desc' });
  assert.deepEqual(desc.data.map((record) => record.slug), ['fictional-a', 'fictional-b', 'fictional-c']);
  assert.equal(desc.pagination.total, 3);
  const asc = await repository.list({ sort: 'updated_asc' });
  assert.deepEqual(asc.data.map((record) => record.slug), ['fictional-c', 'fictional-a', 'fictional-b']);
  const names = await repository.list({ sort: 'name_asc', page: 2, page_size: 2 });
  assert.deepEqual(names.data.map((record) => record.slug), ['fictional-c']);
  assert.deepEqual(names.pagination, { page: 2, page_size: 2, total: 3, total_pages: 2 });
});

test('institution updated sorting uses epochs across offsets, ties by slug and paginates in both directions', async () => {
  const repository = new InMemoryInstitutionRepository([
    syntheticRecord('fictional-offset-later', '虚构较晚', '2026-01-01T23:30:00-02:00'),
    syntheticRecord('fictional-offset-earlier', '虚构较早', '2026-01-02T00:30:00+02:00'),
    syntheticRecord('fictional-tie-b', '虚构同瞬间B', '2026-01-02T08:00:00+08:00'),
    syntheticRecord('fictional-tie-a', '虚构同瞬间A', '2026-01-02T00:00:00Z'),
    syntheticRecord('fictional-tie-c', '虚构同瞬间C', '2026-01-01T19:00:00.000-05:00'),
    ...createFictionalRecords(loadContract()).slice(1),
  ]);
  for (const [sort, expected] of [
    ['updated_desc', ['fictional-offset-later', 'fictional-tie-a', 'fictional-tie-b', 'fictional-tie-c', 'fictional-offset-earlier']],
    ['updated_asc', ['fictional-offset-earlier', 'fictional-tie-a', 'fictional-tie-b', 'fictional-tie-c', 'fictional-offset-later']],
  ] as const) {
    const all = await repository.list({ sort });
    assert.deepEqual(all.data.map((record) => record.slug), expected);
    const paged: string[] = [];
    for (let page = 1; page <= 4; page++) {
      const response = await repository.list({ sort, page, page_size: 2 });
      assert.deepEqual(response.pagination, { page, page_size: 2, total: 5, total_pages: 3 });
      paged.push(...response.data.map((record) => record.slug));
      if (page === 4) assert.deepEqual(response.data, []);
    }
    assert.deepEqual(paged, expected);
  }
  assert.deepEqual((await repository.list({})).data.map((record) => record.slug),
    (await repository.list({ sort: 'updated_desc' })).data.map((record) => record.slug));
});

test('invalid updated timestamps fail sorting with a safe error rather than lexical fallback', async () => {
  const repository = new InMemoryInstitutionRepository([
    syntheticRecord('fictional-invalid', '虚构无效时间', 'SYNTHETIC_INVALID_TIME'),
    syntheticRecord('fictional-valid', '虚构有效时间', '2026-01-02T00:00:00Z'),
  ]);
  for (const sort of ['updated_asc', 'updated_desc'] as const) {
    await assert.rejects(repository.list({ sort }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.statusCode, 500);
      assert.equal(error.code, 'INTERNAL_ERROR');
      assert.doesNotMatch(error.message, /SYNTHETIC_INVALID_TIME|fictional-invalid/);
      return true;
    });
  }
});

test('records and nested public DTOs do not expose mutable repository state', async () => {
  const records = createFictionalRecords(loadContract());
  const repository = new InMemoryInstitutionRepository(records);
  records[0]!.reviewedProjection.name = 'Mutated input';
  const first = await repository.list({});
  first.data[0]!.aliases.push('Injected alias');
  first.data[0]!.region.province = 'Mutated response';
  const second = await repository.list({});
  assert.match(second.data[0]!.name, /虚构/);
  assert.ok(!second.data[0]!.aliases.includes('Injected alias'));
  assert.match(second.data[0]!.region.province, /虚构/);
});
