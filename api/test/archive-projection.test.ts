import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { loadContract } from '../src/infrastructure/openapi/contract.js';
import { mapSource } from '../src/infrastructure/database/public-mappers.js';
import { ApiError } from '../src/shared/errors.js';
import {
  projectSource, projectTimeline, publicUrl, type ArchiveRepository, type PublicMetadata,
  type PublicSource, type PublicTimelineEvent, type SourceRecord, type TimelineRecord,
} from '../src/modules/archive/domain/archive.js';
import { createArchiveFixtures, type ArchiveFixtures } from '../src/modules/archive/infrastructure/fixtures.js';
import { InMemoryInstitutionRepository } from '../src/modules/archive/infrastructure/in-memory-institution-repository.js';

const contract = loadContract();
const prefix = '/api/v1/public';
const slug = 'fictional-mist-harbor-center';
const sourceId = 'src-fictional-demo-notice';
const privateStates = ['DRAFT', 'TEMPORARILY_HIDDEN', 'WITHDRAWN'] as const;
const empty = { data: [], pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 } };

async function withApp(bundle: ArchiveFixtures, run: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: 'test' }), logger: false,
    archiveRepository: new InMemoryInstitutionRepository(bundle.institutions, bundle),
  });
  try { await run(app); } finally { await app.close(); }
}

function source(bundle: ArchiveFixtures, id: string, changes: Partial<PublicSource> = {}): SourceRecord {
  return { publicationState: 'PUBLISHED', reviewedProjection: { ...structuredClone(bundle.sources[0]!.reviewedProjection), id, ...changes } };
}

function event(bundle: ArchiveFixtures, id: string, changes: Partial<PublicTimelineEvent> = {}): TimelineRecord {
  return { publicationState: 'PUBLISHED', reviewedProjection: { ...structuredClone(bundle.timeline[0]!.reviewedProjection), id, ...changes } };
}

test('source and event projections reject every private publication state even with valid public DTOs', () => {
  const bundle = createArchiveFixtures(contract);
  const publicSlugs = new Set([slug]);
  const visibleSource = projectSource(bundle.sources[0]!, publicSlugs);
  assert.ok(visibleSource);
  const sources = new Map([[visibleSource.id, visibleSource]]);
  assert.deepEqual(projectTimeline(bundle.timeline[0]!, sources), bundle.timeline[0]!.reviewedProjection);
  for (const publicationState of privateStates) {
    assert.equal(projectSource({ ...bundle.sources[0]!, publicationState }, publicSlugs), null);
    assert.equal(projectTimeline({ ...bundle.timeline[0]!, publicationState }, sources), null);
  }
});

test('institution source_count and source slugs derive only from valid public associations', async () => {
  const bundle = createArchiveFixtures(contract);
  const original = bundle.institutions[0]!;
  const secondSlug = 'fictional-alpha-center';
  bundle.institutions.push({ ...structuredClone(original), internalId: '00000000-0000-4000-8000-000000000005', reviewedProjection: {
    ...structuredClone(original.reviewedProjection), slug: secondSlug, source_count: 900,
  } });
  original.reviewedProjection.source_count = 999;
  const privateSlugs = bundle.institutions.filter((record) => record.publicationState !== 'PUBLISHED').map((record) => record.reviewedProjection.slug);
  bundle.sources[0]!.reviewedProjection.institution_slugs = [slug, ...privateSlugs, secondSlug, slug, 'fictional-missing', secondSlug];
  bundle.sources.push(
    source(bundle, 'src-fictional-second', { institution_slugs: [slug, slug, ...privateSlugs] }),
    source(bundle, 'src-fictional-orphan', { institution_slugs: [...privateSlugs, 'fictional-missing'] }),
    source(bundle, 'src-fictional-unsafe', { institution_slugs: [slug, secondSlug], url: 'http://localhost/fictional' }),
  );
  await withApp(bundle, async (app) => {
    const institutions = await app.inject(`${prefix}/institutions`);
    assert.equal(institutions.statusCode, 200);
    assert.equal(institutions.json().pagination.total, 2);
    for (const [parent, count] of [[slug, 2], [secondSlug, 1]] as const) {
      const detail = await app.inject(`${prefix}/institutions/${parent}`);
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().data.source_count, count);
      assert.equal(institutions.json().data.find((item: { slug: string }) => item.slug === parent).source_count, count);
      const nested = await app.inject(`${prefix}/institutions/${parent}/sources`);
      const global = await app.inject(`${prefix}/sources?institution_slug=${parent}`);
      assert.equal(nested.statusCode, 200);
      assert.equal(global.statusCode, 200);
      assert.equal(nested.json().pagination.total, count);
      assert.deepEqual(nested.json(), global.json());
    }
    const list = await app.inject(`${prefix}/sources`);
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().pagination.total, 3);
    const canonical = await app.inject(`${prefix}/sources/${sourceId}`);
    assert.equal(canonical.statusCode, 200);
    assert.deepEqual(canonical.json().data.institution_slugs, [secondSlug, slug]);
    assert.deepEqual(list.json().data.find((item: PublicSource) => item.id === sourceId), canonical.json().data);
    const orphan = await app.inject(`${prefix}/sources/src-fictional-orphan`);
    assert.equal(orphan.statusCode, 200);
    assert.deepEqual(orphan.json().data.institution_slugs, []);
    for (const parent of [...privateSlugs, 'fictional-missing']) {
      const filtered = await app.inject(`${prefix}/sources?institution_slug=${parent}`);
      assert.equal(filtered.statusCode, 200);
      assert.deepEqual(filtered.json(), empty);
      assert.ok(!list.body.includes(parent));
    }
    assert.equal((await app.inject(`${prefix}/sources/src-fictional-unsafe`)).statusCode, 404);
  });
});

test('metadata regions include only public institutions, deduplicate by code, and sort stably', async () => {
  const bundle = createArchiveFixtures(contract);
  const original = bundle.institutions[0]!;
  const alphaRegion = { code: 'fictional-alpha-region', name: '虚构甲省', province: '虚构甲省', city: null };
  for (const [index, parent] of ['fictional-alpha-center', 'fictional-another-center'].entries()) {
    bundle.institutions.push({ ...structuredClone(original), internalId: `00000000-0000-4000-8000-00000000000${index + 5}`, reviewedProjection: {
      ...structuredClone(original.reviewedProjection), slug: parent, region: structuredClone(alphaRegion),
    } });
  }
  for (const record of bundle.institutions.filter((entry) => entry.publicationState !== 'PUBLISHED')) {
    record.reviewedProjection.region = {
      code: `fictional-private-${record.publicationState.toLowerCase().replaceAll('_', '-')}-region`,
      name: '虚构私有地区', province: '虚构私有省', city: null,
    };
  }
  await withApp(bundle, async (app) => {
    const response = await app.inject(`${prefix}/metadata`);
    assert.equal(response.statusCode, 200);
    const metadata = response.json<{ data: PublicMetadata }>().data;
    assert.deepEqual(metadata.regions, [alphaRegion, original.reviewedProjection.region]);
    assert.deepEqual(metadata, { ...bundle.referenceMetadata, regions: [alphaRegion, original.reviewedProjection.region] });
    assert.doesNotMatch(response.body, /fictional-private|虚构私有|publicationState/);
    const publicRegion = await app.inject(`${prefix}/institutions?region=fictional-alpha-region`);
    assert.equal(publicRegion.statusCode, 200);
    assert.equal(publicRegion.json().pagination.total, 2);
    for (const record of bundle.institutions.filter((entry) => entry.publicationState !== 'PUBLISHED')) {
      const privateRegion = await app.inject(`${prefix}/institutions?region=${record.reviewedProjection.region.code}`);
      assert.equal(privateRegion.statusCode, 400);
      assert.equal(privateRegion.json().error.code, 'VALIDATION_ERROR');
      assert.ok(!privateRegion.body.includes(record.reviewedProjection.region.code));
    }
  });
  bundle.institutions = bundle.institutions.filter((record) => record.publicationState !== 'PUBLISHED');
  await withApp(bundle, async (app) => {
    const response = await app.inject(`${prefix}/metadata`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { data: { ...bundle.referenceMetadata, regions: [] } });
  });
});

test('nested routes fail closed for private parents even when their children are PUBLISHED', async () => {
  const bundle = createArchiveFixtures(contract);
  const parents = bundle.institutions.filter((record) => record.publicationState !== 'PUBLISHED');
  parents.forEach((parent, index) => {
    bundle.sources.push(source(bundle, `src-fictional-private-parent-${index}`, { institution_slugs: [parent.reviewedProjection.slug] }));
    bundle.timeline.push(event(bundle, `evt-fictional-private-parent-${index}`, { institution_slug: parent.reviewedProjection.slug }));
  });
  await withApp(bundle, async (app) => {
    const missing = await app.inject(`${prefix}/institutions/fictional-missing/timeline`);
    assert.equal(missing.statusCode, 404);
    for (const parent of parents) {
      for (const suffix of ['/sources', '/timeline']) {
        const response = await app.inject(`${prefix}/institutions/${parent.reviewedProjection.slug}${suffix}`);
        assert.equal(response.statusCode, 404);
        assert.deepEqual(response.json(), missing.json());
      }
      const response = await app.inject(`${prefix}/sources?institution_slug=${parent.reviewedProjection.slug}`);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), empty);
    }
  });
});

test('timeline removes private/missing references and drops unsupported or privately published events', async () => {
  const bundle = createArchiveFixtures(contract);
  const privateIds = bundle.sources.slice(1).map((record) => record.reviewedProjection.id);
  bundle.timeline = [
    event(bundle, 'evt-fictional-supported', { source_ids: [...privateIds, sourceId, sourceId, 'src-fictional-missing'] }),
    event(bundle, 'evt-fictional-unsupported', { source_ids: privateIds }),
    event(bundle, 'evt-fictional-missing-source', { source_ids: ['src-fictional-missing'] }),
    event(bundle, 'evt-fictional-no-source', { source_ids: [] }),
    event(bundle, 'evt-fictional-neutral', {
      evidence_status: 'pending_verification', source_ids: [...privateIds, 'src-fictional-missing'], risk_tags: [],
      title: '虚构示例·资料仍待核实', summary: '完全虚构的中立占位说明，尚无公开来源，不陈述具体指控。',
    }),
    ...privateStates.map((publicationState, index) => ({ ...event(bundle, `evt-fictional-private-${index}`), publicationState })),
  ];
  await withApp(bundle, async (app) => {
    const response = await app.inject(`${prefix}/institutions/${slug}/timeline`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().pagination.total, 2);
    assert.deepEqual(response.json().data.map((item: PublicTimelineEvent) => item.id), ['evt-fictional-neutral', 'evt-fictional-supported']);
    assert.deepEqual(response.json().data[0].source_ids, []);
    assert.deepEqual(response.json().data[1].source_ids, [sourceId]);
    for (const id of privateIds) assert.ok(!response.body.includes(id));
    assert.doesNotMatch(response.body, /evt-fictional-unsupported|evt-fictional-missing-source|evt-fictional-no-source|evt-fictional-private/);
  });
  bundle.sources = bundle.sources.map((record) => ({ ...record, publicationState: 'WITHDRAWN' }));
  await withApp(bundle, async (app) => {
    const response = await app.inject(`${prefix}/institutions/${slug}/timeline`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data.map((item: PublicTimelineEvent) => item.id), ['evt-fictional-neutral']);
    assert.equal(response.json().pagination.total, 1);
    const institution = await app.inject(`${prefix}/institutions/${slug}`);
    assert.equal(institution.statusCode, 200);
    assert.equal(institution.json().data.source_count, 0);
  });
});

test('linked responses require a referenced public statement, not an unrelated or private statement', async () => {
  const bundle = createArchiveFixtures(contract);
  bundle.sources.push(
    source(bundle, 'src-fictional-statement', { source_type: 'statement' }),
    { ...source(bundle, 'src-fictional-private-statement', { source_type: 'statement' }), publicationState: 'WITHDRAWN' },
  );
  bundle.timeline = [
    event(bundle, 'evt-fictional-valid-linked', { response_status: 'linked', source_ids: [sourceId, 'src-fictional-statement', sourceId, 'src-fictional-statement'] }),
    event(bundle, 'evt-fictional-no-linked-statement', { response_status: 'linked', source_ids: [sourceId] }),
    event(bundle, 'evt-fictional-private-linked-statement', { response_status: 'linked', source_ids: [sourceId, 'src-fictional-private-statement'] }),
    event(bundle, 'evt-fictional-pending-linked', { response_status: 'linked', evidence_status: 'pending_verification', source_ids: [] }),
  ];
  await withApp(bundle, async (app) => {
    const response = await app.inject(`${prefix}/institutions/${slug}/timeline`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().pagination.total, 1);
    assert.equal(response.json().data[0].id, 'evt-fictional-valid-linked');
    assert.deepEqual(response.json().data[0].source_ids, [sourceId, 'src-fictional-statement']);
    assert.equal(response.json().data[0].response_status, 'linked');
    assert.doesNotMatch(response.body, /private-statement|evt-fictional-no-linked|evt-fictional-private-linked|evt-fictional-pending-linked/);
  });
});

test('timeline rejects reversed or startless date intervals and retains valid and unknown dates', async () => {
  const bundle = createArchiveFixtures(contract);
  bundle.timeline = [
    event(bundle, 'evt-fictional-reversed', { occurred_on: '2026-01-03', occurred_until: '2026-01-01' }),
    event(bundle, 'evt-fictional-startless', { occurred_on: null, occurred_until: '2026-01-03' }),
    event(bundle, 'evt-fictional-unknown', { occurred_on: null, occurred_until: null }),
    event(bundle, 'evt-fictional-equal', { occurred_on: '2026-01-03', occurred_until: '2026-01-03' }),
    event(bundle, 'evt-fictional-range', { occurred_on: '2026-01-01', occurred_until: '2026-01-03' }),
  ];
  await withApp(bundle, async (app) => {
    const response = await app.inject(`${prefix}/institutions/${slug}/timeline`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data.map((item: PublicTimelineEvent) => item.id), ['evt-fictional-equal', 'evt-fictional-range', 'evt-fictional-unknown']);
    assert.equal(response.json().pagination.total, 3);
    assert.doesNotMatch(response.body, /evt-fictional-reversed|evt-fictional-startless/);
  });
});

const unsafeUrls = [
  'not-a-url', '/fictional/relative', 'file:///fictional/example.txt', 'ftp://example.invalid/fictional',
  'javascript:fictional()', 'data:text/plain,fictional',
  'https://fictional-user:fictional-password@example.invalid/fictional',
  'https://fictional-user@example.invalid/fictional', 'https://:fictional-password@example.invalid/fictional',
  'http://localhost/fictional', 'http://LOCALHOST/fictional', 'https://fictional.localhost/fictional',
  'http://fictional.local/fictional', 'http://metadata.google.internal/fictional',
  'http://127.0.0.1/fictional', 'http://127.1/fictional', 'http://2130706433/fictional', 'http://0.0.0.0/fictional',
  'http://10.0.0.1/fictional', 'http://169.254.169.254/fictional', 'http://192.168.0.1/fictional',
  'http://172.16.0.1/fictional', 'http://172.31.255.254/fictional',
  'http://100.64.0.1/fictional', 'http://198.18.0.1/fictional', 'http://192.0.2.1/fictional',
  'http://198.51.100.1/fictional', 'http://203.0.113.1/fictional', 'http://224.0.0.1/fictional',
  'http://fictional.internal/fictional', 'http://fictional.intranet/fictional',
  'http://fictional.lan/fictional', 'http://fictional.home/fictional', 'http://fictional.home.arpa/fictional',
  'http://[::1]/fictional', 'http://[::ffff:127.0.0.1]/fictional',
  'http://localhost./fictional', 'http://LOCALHOST%2e/fictional', 'http://localhost。/fictional',
  'http://fictional-intranet/fictional', 'http://fictional-intranet./fictional',
  'https://fictional.localhost./fictional', 'http://fictional.local./fictional',
  'http://metadata.google.internal./fictional', 'https://example.invalid./fictional',
  'https://example.invalid/fictional#%ZZ',
  ...[
    'token', 'ToKeN', 'access_token', 'ACCESS-TOKEN', 'refresh_token', 'id_token', 'csrf_token',
    'X-Amz-Credential', 'x-amz-signature', 'X-Amz-Date', 'X-Goog-Signature', 'AWSAccessKeyId',
    'signature', 'SignatureVersion', 'sig', 'sign', 'password', 'PASSWORD', 'passwd', 'pwd',
    'client_secret', 'api_key', 'access_key', 'auth', 'authorization', 'jwt', 'session_id',
    'AuthorizationHeader', 'SessionState', 'my.api_key', 'API.KEY', 'Access.Token', 'Pass-Word',
    'code', 'oauth_code', '%61ccess%5ftoken',
  ].flatMap((name) => [
    `https://example.invalid/fictional?page=1&${name}=SYNTHETIC_URL_CREDENTIAL`,
    `https://example.invalid/fictional#${name}=SYNTHETIC_URL_CREDENTIAL`,
  ]),
  'https://example.invalid/fictional?token', 'https://example.invalid/fictional#access_token',
  'https://example.invalid/fictional?view=public;password=SYNTHETIC_URL_CREDENTIAL',
  'https://example.invalid/fictional#/reader?access_token=SYNTHETIC_URL_CREDENTIAL',
  'https://example.invalid/fictional#section&password=SYNTHETIC_URL_CREDENTIAL',
  'https://example.invalid/fictional#access_token%3DSYNTHETIC_URL_CREDENTIAL',
] as const;

const safeUrls = [
  'http://example.invalid/fictional', 'https://example.invalid/fictional',
  'https://archive.example.invalid/fictional',
  'https://EXAMPLE.invalid/fictional?page=2&lang=zh&view=public#section-2',
  'https://example.invalid/fictional?q=fictional&sort=date_desc#section=overview',
  'https://example.invalid/fictional#%E7%AC%AC%E4%BA%8C%E8%8A%82',
  'https://example.invalid/fictional#/reader?page=2',
] as const;

test('URL checks reject sensitive query/fragment names and normalized trailing-dot hosts while retaining public links', () => {
  for (const value of unsafeUrls) assert.equal(publicUrl(value), false, value);
  for (const value of safeUrls) assert.equal(publicUrl(value), true, value);
});

test('projectSource and mapSource enforce the same URL rules for original and archive links', () => {
  const bundle = createArchiveFixtures(contract);
  const publicSlugs = new Set([slug]);
  for (const field of ['url', 'archive_url'] as const) {
    for (const value of [...safeUrls, ...unsafeUrls]) {
      const record = source(bundle, sourceId, { [field]: value });
      const p = record.reviewedProjection;
      const row = { ...p, public_key: p.id };
      if (safeUrls.some((url) => url === value)) {
        assert.deepEqual(projectSource(record, publicSlugs), p);
        assert.deepEqual(mapSource(row, [slug]), p);
      } else {
        assert.equal(projectSource(record, publicSlugs), null);
        assert.throws(() => mapSource(row, [slug]), (error: unknown) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.statusCode, 500);
          assert.equal(error.code, 'INTERNAL_ERROR');
          assert.deepEqual(error.details, []);
          assert.ok(!error.message.includes(value));
          assert.doesNotMatch(error.message, /SYNTHETIC_URL_CREDENTIAL|localhost|example\.invalid/);
          return true;
        });
      }
    }
  }
});

test('unsafe original or archive URLs disappear from source reads, institution counts, and event support', async () => {
  const bundle = createArchiveFixtures(contract);
  const safeHttp = source(bundle, 'src-fictional-safe-http', { url: 'http://example.invalid/fictional?page=2#section-2', archive_url: 'https://archive.example.invalid/fictional?view=public#section=overview' });
  const unsafeSources = unsafeUrls.flatMap((value, index) => [
    source(bundle, `src-fictional-unsafe-url-${index}`, { url: value }),
    source(bundle, `src-fictional-unsafe-archive-${index}`, { archive_url: value }),
  ]);
  bundle.sources.push(safeHttp, ...unsafeSources);
  bundle.timeline.push(
    ...unsafeSources.map((record, index) => event(bundle, `evt-fictional-unsafe-source-${index}`, { source_ids: [record.reviewedProjection.id] })),
    event(bundle, 'evt-fictional-mixed-support', { source_ids: [sourceId, ...unsafeSources.map((record) => record.reviewedProjection.id)] }),
    ...unsafeSources.map((record, index) => event(bundle, `evt-fictional-unsafe-linked-${index}`, { response_status: 'linked', source_ids: [sourceId, record.reviewedProjection.id] })),
  );
  for (const record of unsafeSources) record.reviewedProjection.source_type = 'statement';
  await withApp(bundle, async (app) => {
    for (const path of ['/sources', `/institutions/${slug}/sources`]) {
      const response = await app.inject(`${prefix}${path}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().pagination.total, 2);
      assert.deepEqual(response.json().data.map((item: PublicSource) => item.id), [sourceId, 'src-fictional-safe-http']);
      assert.doesNotMatch(response.body, /unsafe|SYNTHETIC_URL_CREDENTIAL|fictional-user|fictional-password|localhost|metadata\.google\.internal/);
    }
    for (const record of unsafeSources) {
      const response = await app.inject(`${prefix}/sources/${record.reviewedProjection.id}`);
      assert.equal(response.statusCode, 404);
      assert.equal(response.json().error.code, 'NOT_FOUND');
      assert.doesNotMatch(response.body, /fictional-user|fictional-password|localhost|unsafe/);
    }
    const safe = await app.inject(`${prefix}/sources/src-fictional-safe-http`);
    assert.equal(safe.statusCode, 200);
    assert.deepEqual(safe.json().data, safeHttp.reviewedProjection);
    const institution = await app.inject(`${prefix}/institutions/${slug}`);
    assert.equal(institution.statusCode, 200);
    assert.equal(institution.json().data.source_count, 2);
    const timeline = await app.inject(`${prefix}/institutions/${slug}/timeline`);
    assert.equal(timeline.statusCode, 200);
    assert.equal(timeline.json().pagination.total, 2);
    assert.deepEqual(timeline.json().data, [
      bundle.timeline[0]!.reviewedProjection,
      { ...bundle.timeline.find((record) => record.reviewedProjection.id === 'evt-fictional-mixed-support')!.reviewedProjection, source_ids: [sourceId] },
    ]);
    assert.doesNotMatch(timeline.body, /unsafe|SYNTHETIC_URL_CREDENTIAL/);
  });
});

test('source and timeline projection allowlists discard private fields from records and reviewed DTOs', async () => {
  const bundle = createArchiveFixtures(contract);
  const expectedSource = structuredClone(bundle.sources[0]!.reviewedProjection);
  const expectedEvent = structuredClone(bundle.timeline[0]!.reviewedProjection);
  for (const record of [bundle.sources[0]!, bundle.timeline[0]!]) {
    Object.assign(record, { internalId: 'SYNTHETIC_PRIVATE_SENTINEL', internalNotes: 'SYNTHETIC_PRIVATE_SENTINEL' });
    Object.assign(record.reviewedProjection, {
      internal_notes: 'SYNTHETIC_PRIVATE_SENTINEL', contact_email: 'fictional@example.invalid',
      submission_text: 'SYNTHETIC_PRIVATE_SENTINEL', storage_path: '/fictional/private',
    });
  }
  await withApp(bundle, async (app) => {
    for (const path of ['/sources', `/sources/${sourceId}`, `/institutions/${slug}/sources`, `/institutions/${slug}/timeline`]) {
      const response = await app.inject(`${prefix}${path}`);
      assert.equal(response.statusCode, 200, path);
      const expected = path.endsWith('/timeline') ? expectedEvent : expectedSource;
      assert.deepEqual(path === `/sources/${sourceId}` ? response.json().data : response.json().data[0], expected);
      assert.deepEqual(Object.keys(path === `/sources/${sourceId}` ? response.json().data : response.json().data[0]).sort(), Object.keys(expected).sort());
      assert.doesNotMatch(response.body, /SYNTHETIC_PRIVATE_SENTINEL|internal_notes|contact_email|submission_text|storage_path|internalId|internalNotes|publicationState/);
    }
  });
});

test('invalid calendar dates and timestamps fail response validation without exposing malformed records', async () => {
  for (const [field, value] of [
    ['published_on', '2026-02-30'], ['last_checked_at', 'invalid'], ['updated_at', 'invalid'],
  ] as const) {
    const bundle = createArchiveFixtures(contract);
    bundle.sources[0]!.reviewedProjection[field] = value;
    await withApp(bundle, async (app) => {
      for (const path of ['/sources', `/sources/${sourceId}`, `/institutions/${slug}/sources`]) {
        const response = await app.inject(`${prefix}${path}`);
        assert.equal(response.statusCode, 500, field);
        assert.equal(response.json().error.code, 'INTERNAL_ERROR');
        assert.deepEqual(response.json().error.details, []);
        assert.doesNotMatch(response.body, /2026-02-30|invalid|src-fictional|stack/);
      }
    });
  }
  for (const [field, value] of [['occurred_on', '2026-02-30'], ['occurred_until', '2026-13-01'], ['last_reviewed_at', 'invalid']] as const) {
    const bundle = createArchiveFixtures(contract);
    bundle.timeline[0]!.reviewedProjection[field] = value;
    await withApp(bundle, async (app) => {
      const response = await app.inject(`${prefix}/institutions/${slug}/timeline`);
      assert.equal(response.statusCode, 500, field);
      assert.equal(response.json().error.code, 'INTERNAL_ERROR');
      assert.doesNotMatch(response.body, /2026-02-30|2026-13-01|invalid|evt-fictional|stack/);
    });
  }
});

test('response validation rejects additional private source/event/metadata fields from an injected adapter', async () => {
  const bundle = createArchiveFixtures(contract);
  const base = new InMemoryInstitutionRepository(bundle.institutions, bundle);
  const invalidSource = { ...bundle.sources[0]!.reviewedProjection, internal_notes: 'SYNTHETIC_PRIVATE_SENTINEL' };
  const invalidEvent = { ...bundle.timeline[0]!.reviewedProjection, submission_text: 'SYNTHETIC_PRIVATE_SENTINEL' };
  const pagination = { page: 1, page_size: 20, total: 1, total_pages: 1 };
  const repository: ArchiveRepository = {
    mode: 'mock', isReady: () => base.isReady(), list: (query) => base.list(query), findBySlug: (parent) => base.findBySlug(parent),
    listSources: async () => ({ data: [invalidSource], pagination }), findSourceById: async () => invalidSource,
    listInstitutionSources: async () => ({ data: [invalidSource], pagination }),
    listTimeline: async () => ({ data: [invalidEvent], pagination }),
    metadata: async () => ({ ...await base.metadata(), internal_notes: 'SYNTHETIC_PRIVATE_SENTINEL' }),
  };
  const app = await buildApp({ config: loadConfig({ NODE_ENV: 'test' }), logger: false, archiveRepository: repository });
  try {
    for (const path of ['/sources', `/sources/${sourceId}`, `/institutions/${slug}/sources`, `/institutions/${slug}/timeline`, '/metadata']) {
      const response = await app.inject(`${prefix}${path}`);
      assert.equal(response.statusCode, 500, path);
      assert.equal(response.json().error.code, 'INTERNAL_ERROR');
      assert.deepEqual(response.json().error.details, []);
      assert.doesNotMatch(response.body, /SYNTHETIC_PRIVATE_SENTINEL|internal_notes|submission_text|src-fictional|evt-fictional|stack/);
    }
  } finally { await app.close(); }
});

test('source/event/metadata inputs and response arrays cannot mutate stored archive state', async () => {
  const bundle = createArchiveFixtures(contract);
  const repository = new InMemoryInstitutionRepository(bundle.institutions, bundle);
  bundle.sources[0]!.reviewedProjection.title = 'Mutated synthetic input';
  bundle.timeline[0]!.reviewedProjection.title = 'Mutated synthetic input';
  bundle.referenceMetadata.source_types[0]!.label = 'Mutated synthetic input';
  const firstSource = await repository.findSourceById(sourceId);
  assert.ok(firstSource);
  firstSource.institution_slugs.push('fictional-injected');
  const firstTimeline = await repository.listTimeline(slug, {});
  firstTimeline.data[0]!.source_ids.push('src-fictional-injected');
  firstTimeline.data[0]!.risk_tags.push('fee_dispute');
  const firstMetadata = await repository.metadata();
  firstMetadata.regions[0]!.province = 'Mutated synthetic response';
  firstMetadata.source_types[0]!.label = 'Mutated synthetic response';
  const secondSource = await repository.findSourceById(sourceId);
  assert.ok(secondSource);
  assert.match(secondSource.title, /虚构/);
  assert.deepEqual(secondSource.institution_slugs, [slug]);
  const secondTimeline = await repository.listTimeline(slug, {});
  assert.match(secondTimeline.data[0]!.title, /虚构/);
  assert.deepEqual(secondTimeline.data[0]!.source_ids, [sourceId]);
  assert.deepEqual(secondTimeline.data[0]!.risk_tags, ['regulatory_action']);
  const secondMetadata = await repository.metadata();
  assert.match(secondMetadata.regions[0]!.province, /虚构/);
  assert.equal(secondMetadata.source_types[0]!.label, '新闻');
});
