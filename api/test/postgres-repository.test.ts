import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient, QueryResult } from 'pg';
import { ApiError } from '../src/shared/errors.js';
import { createArchiveFixtures } from '../src/modules/archive/infrastructure/fixtures.js';
import { loadContract } from '../src/infrastructure/openapi/contract.js';
import { loadReferenceMetadata, mapInstitution, mapSource, mapTimeline, type DatabaseRow } from '../src/infrastructure/database/public-mappers.js';
import { PostgresArchiveRepository, literalPattern } from '../src/modules/archive/infrastructure/postgres-archive-repository.js';
import { seedSyntheticDatabase } from '../src/infrastructure/database/maintenance.js';
import { createDatabase } from '../src/infrastructure/database/client.js';

test('database close is idempotent without creating any database connection', async () => {
  const database = createDatabase('postgresql://example.invalid/guardian_test');
  const first = database.close();
  assert.equal(database.close(), first);
  await first;
  await database.close();
});

const fixtures = createArchiveFixtures(loadContract());
const institution = fixtures.institutions[0]!.reviewedProjection;
const source = fixtures.sources[0]!.reviewedProjection;
const event = fixtures.timeline[0]!.reviewedProjection;
const institutionRow: DatabaseRow = {
  slug: institution.slug, name: institution.name, aliases: institution.aliases,
  region_code: institution.region.code, region_name: institution.region.name, region_province: institution.region.province, region_city: institution.region.city,
  operating_status: institution.operating_status, risk_tags: institution.risk_tags, evidence_status: institution.evidence_status,
  public_summary: institution.public_summary, source_count: '2', last_reviewed_at: new Date(institution.last_reviewed_at), updated_at: new Date(institution.updated_at),
  internal_notes: 'synthetic forbidden field', internal_id: 'synthetic forbidden key',
};
const sourceRow: DatabaseRow = {
  public_key: source.id, title: source.title, publisher: source.publisher, source_type: source.source_type,
  url: source.url, published_on: source.published_on, summary: source.summary, evidence_status: source.evidence_status,
  link_status: source.link_status, archive_url: source.archive_url, last_checked_at: null, updated_at: new Date(source.updated_at),
  internal_notes: 'synthetic forbidden field',
};
const eventRow: DatabaseRow = {
  public_key: event.id, institution_slug: event.institution_slug, occurred_on: event.occurred_on, occurred_until: event.occurred_until,
  title: event.title, summary: event.summary, evidence_status: event.evidence_status, risk_tags: event.risk_tags,
  response_status: event.response_status, last_reviewed_at: new Date(event.last_reviewed_at),
};

/** No pg pool or socket is created. This fake only observes query boundaries and tagged failures. */
function fakePool(respond: (sql: string, values: readonly unknown[]) => DatabaseRow[] | Promise<DatabaseRow[]>) {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  const releases: boolean[] = [];
  const client = {
    async query(sql: string, values: readonly unknown[] = []): Promise<QueryResult<DatabaseRow>> {
      calls.push({ sql, values });
      const rows = await respond(sql, values);
      return { rows, rowCount: rows.length, command: 'SELECT', oid: 0, fields: [] };
    },
    release(discard = false): void { releases.push(discard); },
  } as unknown as PoolClient;
  return { connect: async () => client, calls, releases };
}
const safeError = (status: number, code: string) => (error: unknown): boolean => {
  assert.ok(error instanceof ApiError);
  assert.equal(error.statusCode, status);
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /SELECT|postgres:|secret|driver|BEGIN/);
  return true;
};

test('explicit mappers use a DTO allowlist and normalize pg timestamps without internal fields', () => {
  const mapped = mapInstitution(institutionRow);
  assert.equal(mapped.source_count, 2);
  assert.equal(mapped.updated_at, new Date(institution.updated_at).toISOString());
  assert.equal('internal_notes' in mapped, false);
  assert.equal('internal_id' in mapped, false);
  assert.equal('visibility' in mapped, false);
  assert.equal('internal_notes' in mapSource(sourceRow, [institution.slug]), false);
  assert.deepEqual(mapTimeline(eventRow, [source.id]).source_ids, [source.id]);
});

test('mapping defects are tagged safe 500, including enum/date/URL defects', () => {
  assert.throws(() => mapInstitution({ ...institutionRow, risk_tags: ['unapproved'] }), safeError(500, 'INTERNAL_ERROR'));
  assert.throws(() => mapInstitution({ ...institutionRow, source_count: 'NaN' }), safeError(500, 'INTERNAL_ERROR'));
  assert.throws(() => mapSource({ ...sourceRow, url: 'http://127.0.0.1/secret' }, []), safeError(500, 'INTERNAL_ERROR'));
  assert.throws(() => mapTimeline({ ...eventRow, occurred_until: '2020-01-01' }, [source.id]), safeError(500, 'INTERNAL_ERROR'));
  assert.throws(() => mapTimeline(eventRow, []), safeError(500, 'INTERNAL_ERROR'));
});

test('reference metadata reads contract version and only safe complete enum dictionaries', () => {
  const reference = loadReferenceMetadata();
  assert.equal(reference.contract_version, '0.1.0');
  assert.equal('regions' in reference, false);
  assert.deepEqual(reference.source_types.map((item) => item.value), ['news', 'video', 'judgment', 'notice', 'report', 'statement']);
});

test('literal keyword escaping does not interpret percent, underscore or backslash', () => {
  assert.equal(literalPattern(' 50%_\\ '), '%50\\%\\_\\\\%');
});

test('failed BEGIN releases the checked-out client; unknown driver errors become safe 503', async () => {
  const pool = fakePool((sql) => { if (sql.startsWith('BEGIN')) throw new Error('driver secret SELECT postgres://secret'); return []; });
  const repo = new PostgresArchiveRepository(pool);
  await assert.rejects(repo.findBySlug(institution.slug), safeError(503, 'SERVICE_UNAVAILABLE'));
  assert.equal(pool.calls.at(-1)?.sql, 'ROLLBACK');
  assert.deepEqual(pool.releases, [false]);
});

test('connect rejection and failed readiness never fall back to mock', async () => {
  const repo = new PostgresArchiveRepository({ connect: async () => { throw { unusual: 'secret driver failure' }; } });
  assert.equal(repo.mode, 'postgres');
  assert.equal(await repo.isReady(), false);
  await assert.rejects(repo.metadata(), safeError(503, 'SERVICE_UNAVAILABLE'));
});

test('query failures rollback, discard a client when rollback fails, and never leak SQL', async () => {
  const pool = fakePool((sql) => { if (sql.includes('SELECT') || sql === 'ROLLBACK') throw new Error('secret SELECT driver'); return []; });
  await assert.rejects(new PostgresArchiveRepository(pool).findSourceById(source.id), safeError(503, 'SERVICE_UNAVAILABLE'));
  assert.deepEqual(pool.releases, [true]);
});

test('successful lists count and paginate in one repeatable read read-only transaction', async () => {
  const pool = fakePool((sql) => sql.startsWith('SELECT count') ? [{ total: '3' }] : sql.includes('SELECT i.slug') ? [institutionRow] : []);
  const result = await new PostgresArchiveRepository(pool).list({ page: 2, page_size: 1, q: ' 50%_ ' });
  assert.deepEqual(result.pagination, { page: 2, page_size: 1, total: 3, total_pages: 3 });
  assert.equal(pool.calls[0]?.sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const selects = pool.calls.filter((call) => call.sql.startsWith('SELECT'));
  assert.equal(selects.length, 2);
  assert.match(selects[0]!.sql, /visibility = 'PUBLISHED'/);
  assert.equal(selects[0]!.values[0], '%50\\%\\_%');
  assert.deepEqual(selects[1]!.values, ['%50\\%\\_%', 1, 1]);
  assert.match(selects[1]!.sql, /NULLS LAST, i.slug COLLATE "C" ASC LIMIT \$2 OFFSET \$3/);
  assert.equal(pool.calls.at(-1)?.sql, 'COMMIT');
  assert.deepEqual(pool.releases, [false]);
});

test('source filter correlates outer source and retains published relations and published institutions', async () => {
  const pool = fakePool((sql) => sql.startsWith('SELECT count') ? [{ total: '0' }] : []);
  await new PostgresArchiveRepository(pool).listSources({ institution_slug: 'fictional-hidden', page: 7, page_size: 5 });
  const count = pool.calls.find((call) => call.sql.startsWith('SELECT count'))!;
  assert.match(count.sql, /related_source\.public_key = ix\.source_key/);
  assert.match(count.sql, /ix\.source_key = s\.public_key AND ix\.institution_slug = \$1/);
  assert.match(count.sql, /i\.visibility = 'PUBLISHED'/);
  assert.deepEqual(count.values, ['fictional-hidden']);
});

test('source relationship hydration occurs on the same client after DB pagination', async () => {
  const pool = fakePool((sql) => sql.startsWith('SELECT count') ? [{ total: '1' }]
    : sql.includes('SELECT s.public_key') ? [sourceRow]
    : sql.includes('SELECT ix.source_key') ? [{ source_key: source.id, institution_slug: institution.slug }] : []);
  const result = await new PostgresArchiveRepository(pool).listSources({ page_size: 1 });
  assert.deepEqual(result.data[0]?.institution_slugs, [institution.slug]);
  const relation = pool.calls.find((call) => call.sql.includes('SELECT ix.source_key'))!;
  assert.deepEqual(relation.values, [[source.id]]);
  assert.match(relation.sql, /ANY\(\$1::text\[\]\)/);
  assert.equal(pool.calls.at(-1)?.sql, 'COMMIT');
});

test('unpublished parents uniformly fail with safe 404 before listing children', async () => {
  const pool = fakePool(() => []);
  const repo = new PostgresArchiveRepository(pool);
  await assert.rejects(repo.listInstitutionSources('fictional-missing', {}), safeError(404, 'NOT_FOUND'));
  await assert.rejects(repo.listTimeline('fictional-missing', {}), safeError(404, 'NOT_FOUND'));
  assert.equal(pool.calls.some((call) => call.sql.startsWith('SELECT count')), false);
});

test('timeline DB visibility requires supporting published relations and a visible statement for linked', async () => {
  const pool = fakePool((sql) => sql.includes('SELECT 1 FROM public_content.published_institutions') ? [{}]
    : sql.startsWith('SELECT count') ? [{ total: '0' }] : []);
  const result = await new PostgresArchiveRepository(pool).listTimeline(institution.slug, { sort: 'date_asc' });
  assert.equal(result.pagination.total, 0);
  const count = pool.calls.find((call) => call.sql.startsWith('SELECT count'))!;
  assert.match(count.sql, /e\.evidence_status = 'pending_verification' OR EXISTS/);
  assert.match(count.sql, /s\.source_type = 'statement'/);
  assert.match(count.sql, /es\.visibility = 'PUBLISHED'/);
  assert.match(pool.calls.find((call) => call.sql.includes('SELECT e.public_key'))!.sql, /ASC NULLS LAST, e.public_key/);
});

test('repository mapper defects remain safe 500 and transaction rolls back', async () => {
  const pool = fakePool((sql) => sql.includes('SELECT i.slug') ? [{ ...institutionRow, public_summary: null }] : []);
  await assert.rejects(new PostgresArchiveRepository(pool).findBySlug(institution.slug), safeError(500, 'INTERNAL_ERROR'));
  assert.equal(pool.calls.at(-1)?.sql, 'ROLLBACK');
  assert.deepEqual(pool.releases, [false]);
});

test('metadata returns live public regions and never seeds fictional region examples', async () => {
  const pool = fakePool((sql) => sql.includes('SELECT region_code') ? [] : []);
  const result = await new PostgresArchiveRepository(pool).metadata();
  assert.deepEqual(result.regions, []);
  assert.equal(result.source_types.length, 6);
  assert.match(pool.calls.find((call) => call.sql.includes('SELECT region_code'))!.sql, /visibility = 'PUBLISHED'/);
});

test('synthetic seed refuses production/unknown environment before connecting', async () => {
  let connections = 0;
  const pool = { connect: async (): Promise<PoolClient> => { connections++; throw new Error('must not connect'); } };
  await assert.rejects(seedSyntheticDatabase(pool, fixtures, 'production'), /NODE_ENV/);
  await assert.rejects(seedSyntheticDatabase(pool, fixtures, undefined), /NODE_ENV/);
  assert.equal(connections, 0);
});

test('synthetic seed is insert-only and releases a client even when BEGIN fails', async () => {
  const pool = fakePool(() => []);
  await seedSyntheticDatabase(pool, fixtures, 'test');
  assert.ok(pool.calls.some((call) => call.sql.startsWith('INSERT')));
  for (const call of pool.calls) {
    assert.doesNotMatch(call.sql, /DELETE|TRUNCATE|DROP|DO UPDATE/);
    if (call.sql.startsWith('INSERT')) assert.match(call.sql, /ON CONFLICT .* DO NOTHING/);
  }
  const bad = fakePool((sql) => { if (sql === 'BEGIN') throw new Error('secret'); return []; });
  await assert.rejects(seedSyntheticDatabase(bad, fixtures, 'test'), /Synthetic database seed failed/);
  assert.deepEqual(bad.releases, [false]);
});
