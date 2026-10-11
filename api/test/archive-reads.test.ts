import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as addFormatsImport } from 'ajv-formats';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { componentSchema, loadContract, resolveSchema, type JsonObject } from '../src/infrastructure/openapi/contract.js';
import type { PublicMetadata, PublicSource, PublicTimelineEvent } from '../src/modules/archive/domain/archive.js';
import { createArchiveFixtures, type ArchiveFixtures } from '../src/modules/archive/infrastructure/fixtures.js';
import { InMemoryInstitutionRepository } from '../src/modules/archive/infrastructure/in-memory-institution-repository.js';

const contract = loadContract();
const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ strict: false }));
const validators = new Map<string, ReturnType<Ajv2020['compile']>>();
const prefix = '/api/v1/public';
const slug = 'fictional-mist-harbor-center';
const sourceId = 'src-fictional-demo-notice';

function assertSchema(name: string, body: unknown): void {
  const validate = validators.get(name) ?? ajv.compile(componentSchema(contract, name));
  validators.set(name, validate);
  assert.ok(validate(body), `${name}: ${ajv.errorsText(validate.errors)}`);
}

function example(name: string): unknown {
  return (resolveSchema(contract, { $ref: `#/components/examples/${name}` }) as JsonObject).value;
}

async function withApp(run: (app: FastifyInstance) => Promise<void>, bundle?: ArchiveFixtures): Promise<void> {
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test' }), logger: false,
    ...(bundle ? { archiveRepository: new InMemoryInstitutionRepository(bundle.institutions, bundle) } : {}),
  });
  try { await run(app); } finally { await app.close(); }
}

const canonicalReads = [
  ['/institutions', 'InstitutionListResponse', 'InstitutionList'],
  [`/institutions/${slug}`, 'InstitutionDetailResponse', 'InstitutionDetail'],
  [`/institutions/${slug}/timeline`, 'TimelineListResponse', 'TimelineList'],
  [`/institutions/${slug}/sources`, 'SourceListResponse', 'SourceList'],
  ['/sources', 'SourceListResponse', 'SourceList'],
  [`/sources/${sourceId}`, 'SourceDetailResponse', 'SourceDetail'],
  ['/metadata', 'MetadataResponse', 'Metadata'],
] as const;

for (const [path, schema, canonical] of canonicalReads) {
  test(`GET ${path} returns the canonical example satisfying its OpenAPI 0.1.0 schema`, async () => {
    await withApp(async (app) => {
      const response = await app.inject({ url: `${prefix}${path}`, headers: { 'x-request-id': 'archive-canonical_1' } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.match(String(response.headers['x-request-id']), /^[0-9a-f-]{36}$/);
      assert.notEqual(response.headers['x-request-id'], 'archive-canonical_1');
      assert.match(String(response.headers['content-type']), /^application\/json/);
      assertSchema(schema, response.json());
      assert.deepEqual(response.json(), example(canonical));
      assert.doesNotMatch(response.body, /internalId|internalNotes|publicationState|private note|00000000|request_id/);
    });
  });
}

test('source list, institution sources, and source detail share the same public DTO', async () => {
  await withApp(async (app) => {
    const list = await app.inject(`${prefix}/sources`);
    const nested = await app.inject(`${prefix}/institutions/${slug}/sources`);
    const detail = await app.inject(`${prefix}/sources/${sourceId}`);
    assert.equal(list.statusCode, 200);
    assert.equal(nested.statusCode, 200);
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(nested.json(), list.json());
    assert.deepEqual(detail.json(), { data: list.json().data[0] });
    assert.equal(list.json().data[0].published_on, '2026-01-01');
    assert.equal(list.json().data[0].archive_url, null);
    assert.equal(list.json().data[0].last_checked_at, null);
    assert.deepEqual(list.json().data[0].institution_slugs, [slug]);
  });
});

test('private and missing sources and nested parent institutions have indistinguishable 404s', async () => {
  await withApp(async (app) => {
    const missing = await app.inject(`${prefix}/sources/src-fictional-missing`);
    assert.equal(missing.statusCode, 404);
    assertSchema('ErrorResponse', missing.json());
    assert.equal(missing.json().error.code, 'NOT_FOUND');
    assert.deepEqual(missing.json().error.details, []);
    for (const id of ['src-fictional-draft', 'src-fictional-temporarily-hidden', 'src-fictional-withdrawn']) {
      const response = await app.inject(`${prefix}/sources/${id}`);
      assert.equal(response.statusCode, 404, id);
      assert.deepEqual(response.json(), missing.json());
    }
    for (const parent of ['fictional-draft', 'fictional-temporarily-hidden', 'fictional-withdrawn', 'fictional-missing']) {
      for (const suffix of ['', '/sources', '/timeline']) {
        const response = await app.inject(`${prefix}/institutions/${parent}${suffix}`);
        assert.equal(response.statusCode, 404, `${parent}${suffix}`);
        assert.deepEqual(response.json(), missing.json());
        assert.doesNotMatch(response.body, /DRAFT|HIDDEN|WITHDRAWN|publicationState|internal/i);
      }
    }
  });
});

test('global source filtering for private or missing institutions is an empty 200, not a parent 404', async () => {
  await withApp(async (app) => {
    for (const parent of ['fictional-draft', 'fictional-temporarily-hidden', 'fictional-withdrawn', 'fictional-missing']) {
      const response = await app.inject(`${prefix}/sources?institution_slug=${parent}`);
      assert.equal(response.statusCode, 200, parent);
      assertSchema('SourceListResponse', response.json());
      assert.deepEqual(response.json(), example('EmptyList'));
    }
  });
});

test('metadata dictionaries are complete, unique, and exactly match the public contract enums', async () => {
  await withApp(async (app) => {
    const response = await app.inject(`${prefix}/metadata`);
    assert.equal(response.statusCode, 200);
    const metadata = response.json<{ data: PublicMetadata }>().data;
    assert.equal(metadata.contract_version, (contract.info as JsonObject).version);
    for (const [dictionary, schema] of [
      ['evidence_statuses', 'EvidenceStatus'], ['risk_tags', 'RiskTag'],
      ['operating_statuses', 'OperatingStatus'], ['source_types', 'SourceType'],
    ] as const) {
      const entries = metadata[dictionary];
      const values = entries.map((entry) => entry.value);
      assert.equal(new Set(values).size, values.length, dictionary);
      assert.deepEqual([...values].sort(), [...componentSchema(contract, schema).enum as string[]].sort(), dictionary);
      for (const entry of entries) {
        assert.deepEqual(Object.keys(entry).sort(), ['description', 'label', 'value']);
        assert.ok(entry.label.trim());
        assert.ok(entry.description.trim());
      }
    }
    assert.equal(new Set(metadata.regions.map((region) => region.code)).size, metadata.regions.length);
    assert.doesNotMatch(response.body, /DRAFT|TEMPORARILY_HIDDEN|WITHDRAWN|internalNotes|publicationState/);
  });
});

test('source search matches only title/publisher and combines filters with AND', async () => {
  await withApp(async (app) => {
    for (const path of ['/sources', `/institutions/${slug}/sources`]) {
      for (const q of ['  资料演示通告  ', '  雾省资料演示署  ']) {
        const query = new URLSearchParams({ q, source_type: 'notice', evidence_status: 'official_record', page_size: '1' });
        const response = await app.inject(`${prefix}${path}?${query}`);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json().data.map((source: PublicSource) => source.id), [sourceId]);
        assert.deepEqual(response.json().pagination, { page: 1, page_size: 1, total: 1, total_pages: 1 });
      }
      for (const query of ['q=fictional', 'q=不存在', 'source_type=news', 'evidence_status=single_source', 'q=通告&source_type=statement']) {
        const response = await app.inject(`${prefix}${path}?${query}`);
        assert.equal(response.statusCode, 200, query);
        assert.deepEqual(response.json(), example('EmptyList'));
      }
    }
    const associated = await app.inject(`${prefix}/sources?institution_slug=${slug}&source_type=notice&evidence_status=official_record`);
    assert.equal(associated.statusCode, 200);
    assert.equal(associated.json().pagination.total, 1);
  });
});

test('source and timeline lists retain requested pages and actual public totals beyond the last page', async () => {
  await withApp(async (app) => {
    for (const path of ['/sources', `/institutions/${slug}/sources`, `/institutions/${slug}/timeline`]) {
      const beyond = await app.inject(`${prefix}${path}?page=2&page_size=1`);
      assert.equal(beyond.statusCode, 200);
      assert.deepEqual(beyond.json(), { data: [], pagination: { page: 2, page_size: 1, total: 1, total_pages: 1 } });
      const bounds = await app.inject(`${prefix}${path}?page=1000000&page_size=50`);
      assert.equal(bounds.statusCode, 200);
      assert.deepEqual(bounds.json(), { data: [], pagination: { page: 1000000, page_size: 50, total: 1, total_pages: 1 } });
    }
  });
});

test('all seven routes reject visibility overrides and unknown or repeated queries without echoing values', async () => {
  await withApp(async (app) => {
    for (const [path] of canonicalReads) {
      for (const query of ['visibility=PUBLISHED', 'unknown=SECRET_SENTINEL', 'unknown=one&unknown=two']) {
        const response = await app.inject(`${prefix}${path}?${query}`);
        assert.equal(response.statusCode, 400, `${path}?${query}`);
        assertSchema('ErrorResponse', response.json());
        assert.equal(response.json().error.code, 'VALIDATION_ERROR');
        assert.doesNotMatch(response.body, /SECRET_SENTINEL|PUBLISHED|stack|sql/i);
        assert.ok(response.headers['x-request-id']);
      }
    }
  });
});

test('archive queries reject nondecimal, invalid, duplicate, and route-inapplicable parameters', async () => {
  await withApp(async (app) => {
    const lists = ['/sources', `/institutions/${slug}/sources`, `/institutions/${slug}/timeline`];
    for (const path of lists) {
      for (const query of [
        'page=0', 'page=1000001', 'page=-1', 'page=1.5', 'page=1e2', 'page=0x10', 'page=', 'page=%2B1', 'page=%201',
        'page_size=0', 'page_size=51', 'page_size=abc', 'page=1&page=1', 'sort=invalid',
      ]) {
        const response = await app.inject(`${prefix}${path}?${query}`);
        assert.equal(response.statusCode, 400, `${path}?${query}`);
        assert.equal(response.json().error.code, 'VALIDATION_ERROR');
        assertSchema('ErrorResponse', response.json());
      }
    }
    for (const path of lists.slice(0, 2)) {
      for (const query of ['source_type=invalid', 'evidence_status=invalid', 'sort=date_asc', 'q=a&q=a', `q=${'a'.repeat(101)}`, 'region=fictional-mist-region']) {
        assert.equal((await app.inject(`${prefix}${path}?${query}`)).statusCode, 400, `${path}?${query}`);
      }
    }
    for (const query of ['institution_slug=InvalidSlug', 'institution_slug=']) {
      assert.equal((await app.inject(`${prefix}/sources?${query}`)).statusCode, 400, query);
    }
    assert.equal((await app.inject(`${prefix}/institutions/${slug}/sources?institution_slug=${slug}`)).statusCode, 400);
    for (const query of ['q=通告', 'source_type=notice', 'evidence_status=official_record', 'sort=published_desc']) {
      assert.equal((await app.inject(`${prefix}/institutions/${slug}/timeline?${query}`)).statusCode, 400, query);
    }
    for (const path of ['/sources/InvalidId', '/sources/fictional-missing', '/institutions/InvalidSlug/sources', '/institutions/InvalidSlug/timeline']) {
      assert.equal((await app.inject(`${prefix}${path}`)).statusCode, 400, path);
    }
    assert.equal((await app.inject(`${prefix}/metadata?page=1`)).statusCode, 400);
    assert.equal((await app.inject(`${prefix}/sources/${sourceId}?q=通告`)).statusCode, 400);
  });
});

test('source and timeline sorting keep null dates last, break ties by public id, and paginate stably', async () => {
  const bundle = createArchiveFixtures(contract);
  const source = bundle.sources[0]!;
  const event = bundle.timeline[0]!;
  const dates = [['z', null], ['b', '2026-01-03'], ['c', '2026-01-01'], ['a', '2026-01-03'], ['n', null]] as const;
  bundle.sources = dates.map(([key, date]) => ({ ...source, reviewedProjection: {
    ...structuredClone(source.reviewedProjection), id: `src-fictional-${key}`, published_on: date,
    updated_at: key === 'c' ? '2026-01-04T00:00:00Z' : '2026-01-05T00:00:00Z',
  } }));
  bundle.timeline = dates.map(([key, date]) => ({ ...event, reviewedProjection: {
    ...structuredClone(event.reviewedProjection), id: `evt-fictional-${key}`, occurred_on: date, source_ids: ['src-fictional-a'],
  } }));
  await withApp(async (app) => {
    for (const path of ['/sources', `/institutions/${slug}/sources`]) {
      for (const [sort, order] of [
        ['', ['a', 'b', 'c', 'n', 'z']], ['published_desc', ['a', 'b', 'c', 'n', 'z']],
        ['published_asc', ['c', 'a', 'b', 'n', 'z']], ['updated_desc', ['a', 'b', 'n', 'z', 'c']],
      ] as const) {
        const response = await app.inject(`${prefix}${path}${sort ? `?sort=${sort}` : ''}`);
        assert.equal(response.statusCode, 200);
        assertSchema('SourceListResponse', response.json());
        assert.deepEqual(response.json().data.map((item: PublicSource) => item.id), order.map((key) => `src-fictional-${key}`));
      }
      const ids: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const response = await app.inject(`${prefix}${path}?sort=published_asc&page=${page}&page_size=2`);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json().pagination, { page, page_size: 2, total: 5, total_pages: 3 });
        ids.push(...response.json().data.map((item: PublicSource) => item.id));
      }
      assert.deepEqual(ids, ['c', 'a', 'b', 'n', 'z'].map((key) => `src-fictional-${key}`));
    }
    for (const [sort, order] of [['', ['a', 'b', 'c', 'n', 'z']], ['date_desc', ['a', 'b', 'c', 'n', 'z']], ['date_asc', ['c', 'a', 'b', 'n', 'z']]] as const) {
      const response = await app.inject(`${prefix}/institutions/${slug}/timeline${sort ? `?sort=${sort}` : ''}`);
      assert.equal(response.statusCode, 200);
      assertSchema('TimelineListResponse', response.json());
      assert.deepEqual(response.json().data.map((item: PublicTimelineEvent) => item.id), order.map((key) => `evt-fictional-${key}`));
    }
    const page = await app.inject(`${prefix}/institutions/${slug}/timeline?sort=date_asc&page=2&page_size=2`);
    assert.equal(page.statusCode, 200);
    assert.deepEqual(page.json().data.map((item: PublicTimelineEvent) => item.id), ['evt-fictional-b', 'evt-fictional-n']);
    assert.deepEqual(page.json().pagination, { page: 2, page_size: 2, total: 5, total_pages: 3 });
  }, bundle);
});

test('source updated_desc compares actual instants across offsets and preserves public-key ties across pages', async () => {
  const bundle = createArchiveFixtures(contract);
  const base = bundle.sources[0]!;
  bundle.sources = [
    ['later', '2026-01-01T23:30:00-02:00'],
    ['earlier', '2026-01-02T00:30:00+02:00'],
    ['tie-b', '2026-01-02T08:00:00+08:00'],
    ['tie-a', '2026-01-02T00:00:00Z'],
    ['tie-c', '2026-01-01T19:00:00.000-05:00'],
  ].map(([key, updated]) => ({ ...base, reviewedProjection: {
    ...structuredClone(base.reviewedProjection), id: `src-fictional-${key}`, updated_at: updated!,
  } }));
  const expected = ['later', 'tie-a', 'tie-b', 'tie-c', 'earlier'].map((key) => `src-fictional-${key}`);
  await withApp(async (app) => {
    for (const path of ['/sources', `/institutions/${slug}/sources`]) {
      const all = await app.inject(`${prefix}${path}?sort=updated_desc`);
      assert.equal(all.statusCode, 200);
      assertSchema('SourceListResponse', all.json());
      assert.deepEqual(all.json().data.map((item: PublicSource) => item.id), expected);
      const paged: string[] = [];
      for (let page = 1; page <= 4; page++) {
        const response = await app.inject(`${prefix}${path}?sort=updated_desc&page=${page}&page_size=2`);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json().pagination, { page, page_size: 2, total: 5, total_pages: 3 });
        paged.push(...response.json().data.map((item: PublicSource) => item.id));
        if (page === 4) assert.deepEqual(response.json().data, []);
      }
      assert.deepEqual(paged, expected);
    }
  }, bundle);
});

test('q is trimmed case-insensitive literal text, not wildcard, regex, HTML, or a query expression', async () => {
  const bundle = createArchiveFixtures(contract);
  const base = bundle.sources[0]!;
  bundle.sources = [
    ['regex', '虚构示例 literal .* title', '虚构示例发布者'],
    ['wildcard', '虚构示例 literal 100%_ title', '虚构示例发布者'],
    ['html', '虚构示例 literal <script> title', '虚构示例发布者'],
    ['expression', '虚构示例 literal " OR 1=1 -- title', '虚构示例发布者'],
    ['publisher', '虚构示例普通标题', '虚构示例 MiXeD Publisher'],
  ].map(([key, title, publisher]) => ({ ...base, reviewedProjection: {
    ...structuredClone(base.reviewedProjection), id: `src-fictional-${key}`, title: title!, publisher: publisher!,
    summary: '虚构示例 summary-only-marker，不对应真实资料。',
  } }));
  await withApp(async (app) => {
    for (const path of ['/sources', `/institutions/${slug}/sources`]) {
      for (const [q, key] of [['  .*  ', 'regex'], ['100%_', 'wildcard'], ['<script>', 'html'], ['" OR 1=1 --', 'expression'], ['  mixed publisher  ', 'publisher']]) {
        const response = await app.inject(`${prefix}${path}?${new URLSearchParams({ q: q! })}`);
        assert.equal(response.statusCode, 200);
        assertSchema('SourceListResponse', response.json());
        assert.deepEqual(response.json().data.map((item: PublicSource) => item.id), [`src-fictional-${key}`]);
        assert.equal(response.json().pagination.total, 1);
      }
      for (const q of ['^.*$', 'summary-only-marker', 'example.invalid', slug]) {
        const response = await app.inject(`${prefix}${path}?${new URLSearchParams({ q })}`);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), example('EmptyList'));
      }
      for (const q of ['', '   ']) {
        const response = await app.inject(`${prefix}${path}?${new URLSearchParams({ q })}`);
        assert.equal(response.statusCode, 200);
        assert.equal(response.json().pagination.total, 5);
      }
    }
  }, bundle);
});

test('all seven reads fail with generic 503s in the unavailable postgres adapter without mock fallback', async () => {
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test', DATA_ADAPTER: 'postgres' }), logger: false });
  try {
    for (const [path] of canonicalReads) {
      const response = await app.inject(`${prefix}${path}`);
      assert.equal(response.statusCode, 503, path);
      assertSchema('ErrorResponse', response.json());
      assert.deepEqual(response.json(), { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable', details: [] } });
      assert.doesNotMatch(response.body, /postgres|database|connection|password|mock|fictional/i);
    }
  } finally { await app.close(); }
});
