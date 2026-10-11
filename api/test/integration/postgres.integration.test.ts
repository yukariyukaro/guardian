import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as addFormatsImport } from 'ajv-formats';
import { componentSchema, loadContract } from '../../src/infrastructure/openapi/contract.js';
import { createArchiveFixtures } from '../../src/modules/archive/infrastructure/fixtures.js';
import { PostgresArchiveRepository } from '../../src/modules/archive/infrastructure/postgres-archive-repository.js';
import { migrateDatabase, seedSyntheticDatabase } from '../../src/infrastructure/database/maintenance.js';
import { ApiError } from '../../src/shared/errors.js';
import type { InstitutionRecord } from '../../src/modules/archive/domain/institution.js';
import type { SourceRecord, TimelineRecord } from '../../src/modules/archive/domain/archive.js';
import { validateIntegrationTargets } from '../support/integration-target.js';

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;

/** Independent opt-in suite. A missing URL is a failed/unexecuted check, never a skipped green check. */
test('real PostgreSQL archive migration, projections, pagination and visibility', { timeout: 90_000 }, async (t) => {
  const { maintenanceUrl: connectionString } = validateIntegrationTargets(process.env);
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000 });
  pool.on('error', () => {});
  let cleanup: (() => Promise<void>) | undefined;
  t.after(async () => {
    try { await cleanup?.(); } finally { await pool.end(); }
  });
  await migrateDatabase(pool);
  // Running the migrator twice must be non-destructive and idempotent.
  await migrateDatabase(pool);
  const fixtures = createArchiveFixtures(loadContract());
  const baseInstitution = fixtures.institutions[0]!.reviewedProjection;
  const baseSource = fixtures.sources[0]!.reviewedProjection;
  const baseEvent = fixtures.timeline[0]!.reviewedProjection;
  const key = randomUUID().replaceAll('-', '').slice(0, 12);
  const prefix = `fictional-test-${key}`;
  const publicSlug = `${prefix}-public`;
  const hiddenSlug = `${prefix}-hidden`;
  const draftSlug = `${prefix}-draft`;
  const withdrawnSlug = `${prefix}-withdrawn`;
  const region = { ...baseInstitution.region, code: `${prefix}-region` };
  const updatedAt = '2026-06-01T00:00:00.000Z';
  const institutions: InstitutionRecord[] = [
    ...(['PUBLISHED', 'DRAFT', 'TEMPORARILY_HIDDEN', 'WITHDRAWN'] as const).map((publicationState, index) => ({
      internalId: randomUUID(), internalNotes: 'Synthetic private data must not be projected', publicationState,
      reviewedProjection: {
        ...baseInstitution, slug: [publicSlug, draftSlug, hiddenSlug, withdrawnSlug][index]!,
        name: `${prefix} institution ${index}`, aliases: [`${prefix} literal 50%_\\ alias`], region,
        source_count: 999, updated_at: updatedAt,
      },
    })),
  ];
  const sourceA = `src-${prefix}-a`;
  const sourceB = `src-${prefix}-b`;
  const sourceUnknownDate = `src-${prefix}-null`;
  const sourceHidden = `src-${prefix}-hidden`;
  const statementId = `src-${prefix}-statement`;
  const sources: SourceRecord[] = [
    { publicationState: 'PUBLISHED', reviewedProjection: { ...baseSource, id: sourceA, title: `${prefix} literal 50%_\\ source`, institution_slugs: [publicSlug, hiddenSlug], published_on: '2026-01-01', updated_at: updatedAt } },
    { publicationState: 'PUBLISHED', reviewedProjection: { ...baseSource, id: sourceB, title: `${prefix} b`, institution_slugs: [publicSlug], published_on: '2026-01-01', updated_at: updatedAt } },
    { publicationState: 'PUBLISHED', reviewedProjection: { ...baseSource, id: sourceUnknownDate, title: `${prefix} null`, institution_slugs: [publicSlug], published_on: null, updated_at: updatedAt } },
    { publicationState: 'TEMPORARILY_HIDDEN', reviewedProjection: { ...baseSource, id: sourceHidden, title: `${prefix} hidden`, institution_slugs: [publicSlug], updated_at: updatedAt } },
    { publicationState: 'PUBLISHED', reviewedProjection: { ...baseSource, id: statementId, title: `${prefix} response`, source_type: 'statement', institution_slugs: [publicSlug], published_on: '2025-01-01', updated_at: updatedAt } },
  ];
  const eventA = `evt-${prefix}-a`;
  const eventB = `evt-${prefix}-b`;
  const eventUnknownDate = `evt-${prefix}-null`;
  const linkedEvent = `evt-${prefix}-linked`;
  const unsupportedEvent = `evt-${prefix}-unsupported`;
  const hiddenEvent = `evt-${prefix}-hidden`;
  const timeline: TimelineRecord[] = [
    { publicationState: 'PUBLISHED', reviewedProjection: { ...baseEvent, id: eventA, institution_slug: publicSlug, source_ids: [sourceA, sourceHidden], occurred_on: '2026-01-01' } },
    { publicationState: 'PUBLISHED', reviewedProjection: { ...baseEvent, id: eventB, institution_slug: publicSlug, source_ids: [sourceA], occurred_on: '2026-01-01' } },
    { publicationState: 'PUBLISHED', reviewedProjection: { ...baseEvent, id: eventUnknownDate, institution_slug: publicSlug, source_ids: [], evidence_status: 'pending_verification', occurred_on: null, occurred_until: null } },
    { publicationState: 'PUBLISHED', reviewedProjection: { ...baseEvent, id: linkedEvent, institution_slug: publicSlug, source_ids: [sourceB, statementId], response_status: 'linked', occurred_on: '2025-01-01' } },
    { publicationState: 'PUBLISHED', reviewedProjection: { ...baseEvent, id: unsupportedEvent, institution_slug: publicSlug, source_ids: [sourceHidden], occurred_on: '2027-01-01' } },
    { publicationState: 'TEMPORARILY_HIDDEN', reviewedProjection: { ...baseEvent, id: hiddenEvent, institution_slug: publicSlug, source_ids: [sourceA], occurred_on: '2027-01-01' } },
  ];
  const graph = { institutions, sources, timeline };
  await seedSyntheticDatabase(pool, graph, 'test');
  await seedSyntheticDatabase(pool, graph, 'test');
  // This suite never resets or deletes content. Only its own random keys are hidden on cleanup.
  cleanup = async () => {
    await pool.query(`UPDATE public_content.published_timeline_events SET visibility = 'TEMPORARILY_HIDDEN' WHERE institution_slug = ANY($1::text[])`, [institutions.map((record) => record.reviewedProjection.slug)]);
    await pool.query(`UPDATE public_content.published_sources SET visibility = 'TEMPORARILY_HIDDEN' WHERE public_key = ANY($1::text[])`, [sources.map((record) => record.reviewedProjection.id)]);
    await pool.query(`UPDATE public_content.published_institutions SET visibility = 'TEMPORARILY_HIDDEN' WHERE slug = ANY($1::text[])`, [institutions.map((record) => record.reviewedProjection.slug)]);
  };
  const repository = new PostgresArchiveRepository(pool);
  const document = loadContract();
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const validate = (schema: string, value: unknown): void => {
    const validator = ajv.compile(componentSchema(document, schema));
    assert.ok(validator(value), `Response must conform to ${schema}`);
  };

  await t.test('ready and public projections; legacy additions are nullable and default private', async () => {
    assert.equal(await repository.isReady(), true);
    const detail = await repository.findBySlug(publicSlug);
    assert.ok(detail);
    assert.equal(detail.source_count, 4, 'source_count is live, not the fixture value 999');
    assert.equal('internalNotes' in detail, false);
    validate('PublicInstitution', detail);
    for (const slug of [draftSlug, hiddenSlug, withdrawnSlug, `${prefix}-missing`]) assert.equal(await repository.findBySlug(slug), null);
    const columns = await pool.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public_content' AND table_name = 'published_institutions'`);
    assert.equal(columns.rows.find((row) => row.column_name === 'aliases')?.is_nullable, 'YES');
    assert.match(String(columns.rows.find((row) => row.column_name === 'visibility')?.column_default), /DRAFT/);
    const keyColumns = await pool.query(`SELECT a.attname FROM pg_index idx JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = ANY(idx.indkey)
      WHERE idx.indrelid = 'public_content.published_institutions'::regclass AND idx.indisprimary`);
    assert.deepEqual(keyColumns.rows.map((row) => row.attname), ['slug']);
    const violatesCheck = (error: unknown): boolean => error instanceof pg.DatabaseError && error.code === '23514';
    await assert.rejects(pool.query(`UPDATE public_content.published_institutions SET operating_status = 'unapproved' WHERE slug = $1`, [publicSlug]), violatesCheck);
    await assert.rejects(pool.query(`UPDATE public_content.published_institutions SET risk_tags = ARRAY['unapproved'] WHERE slug = $1`, [publicSlug]), violatesCheck);
    await assert.rejects(pool.query(`UPDATE public_content.published_sources SET source_type = 'unapproved' WHERE public_key = $1`, [sourceA]), violatesCheck);
    await assert.rejects(pool.query(`UPDATE public_content.published_timeline_events SET response_status = 'unapproved' WHERE public_key = $1`, [eventA]), violatesCheck);
  });

  await t.test('DB filtering, literal wildcard input, pagination and empty-page totals', async () => {
    const list = await repository.list({ q: prefix, page: 1, page_size: 1 });
    assert.equal(list.pagination.total, 1);
    assert.equal(list.data[0]?.slug, publicSlug);
    const literal = await repository.list({ q: `${prefix} literal 50%_\\` });
    assert.equal(literal.pagination.total, 1);
    assert.equal((await repository.list({ q: `${prefix} literal 50x_\\` })).pagination.total, 0);
    const page = await repository.list({ q: prefix, page: 3, page_size: 1 });
    assert.deepEqual(page.pagination, { page: 3, page_size: 1, total: 1, total_pages: 1 });
    assert.deepEqual(page.data, []);
    assert.equal((await repository.list({ region: region.code, evidence_status: baseInstitution.evidence_status, operating_status: baseInstitution.operating_status, risk_tag: baseInstitution.risk_tags[0]! })).data[0]?.slug, publicSlug);
    await assert.rejects(repository.list({ region: `${prefix}-absent` }), (error: unknown) => error instanceof ApiError && error.statusCode === 400);
    validate('InstitutionListResponse', list);
  });

  await t.test('source public-key relations, stable ordering and null dates last in both directions', async () => {
    const list = await repository.listSources({ institution_slug: publicSlug });
    assert.deepEqual(list.data.map((source) => source.id), [sourceA, sourceB, statementId, sourceUnknownDate]);
    assert.deepEqual((await repository.listSources({ institution_slug: publicSlug, sort: 'published_asc' })).data.map((source) => source.id), [statementId, sourceA, sourceB, sourceUnknownDate]);
    const details = await repository.findSourceById(sourceA);
    assert.deepEqual(details?.institution_slugs, [publicSlug]);
    assert.equal(await repository.findSourceById(sourceHidden), null);
    assert.equal((await repository.listSources({ institution_slug: hiddenSlug })).pagination.total, 0);
    assert.equal((await repository.listSources({ q: `${prefix} literal 50%_\\` })).pagination.total, 1);
    assert.equal((await repository.listSources({ institution_slug: publicSlug, source_type: 'statement' })).pagination.total, 1);
    const emptyPage = await repository.listInstitutionSources(publicSlug, { page: 99, page_size: 1 });
    assert.equal(emptyPage.pagination.total, 4);
    assert.deepEqual(emptyPage.data, []);
    await assert.rejects(repository.listInstitutionSources(hiddenSlug, {}), (error: unknown) => error instanceof ApiError && error.statusCode === 404);
    validate('SourceListResponse', list);
  });

  await t.test('event support, linked statement and live withdrawal filtering', async () => {
    const list = await repository.listTimeline(publicSlug, {});
    assert.deepEqual(list.data.map((event) => event.id), [eventA, eventB, linkedEvent, eventUnknownDate]);
    assert.deepEqual(list.data[0]?.source_ids, [sourceA]);
    assert.equal(list.pagination.total, 4);
    assert.deepEqual((await repository.listTimeline(publicSlug, { sort: 'date_asc' })).data.map((event) => event.id), [linkedEvent, eventA, eventB, eventUnknownDate]);
    await pool.query(`UPDATE public_content.published_sources SET visibility = 'WITHDRAWN' WHERE public_key = $1`, [statementId]);
    assert.equal((await repository.findBySlug(publicSlug))?.source_count, 3);
    assert.equal((await repository.listTimeline(publicSlug, {})).data.some((event) => event.id === linkedEvent), false);
    await pool.query(`UPDATE public_content.published_sources SET visibility = 'TEMPORARILY_HIDDEN' WHERE public_key = $1`, [sourceA]);
    assert.deepEqual((await repository.listTimeline(publicSlug, {})).data.map((event) => event.id), [eventUnknownDate]);
    await pool.query(`UPDATE public_content.published_sources SET visibility = 'PUBLISHED' WHERE public_key = ANY($1::text[])`, [[sourceA, statementId]]);
    validate('TimelineListResponse', list);
  });

  await t.test('association visibility itself is enforced on count, sources and event support', async () => {
    await pool.query(`UPDATE public_content.institution_sources SET visibility = 'WITHDRAWN' WHERE institution_slug = $1 AND source_key = $2`, [publicSlug, sourceB]);
    assert.equal((await repository.findBySlug(publicSlug))?.source_count, 3);
    assert.deepEqual((await repository.findSourceById(sourceB))?.institution_slugs, []);
    assert.equal((await repository.listInstitutionSources(publicSlug, {})).data.some((source) => source.id === sourceB), false);
    await pool.query(`UPDATE public_content.timeline_sources SET visibility = 'WITHDRAWN' WHERE event_key = $1 AND source_key = $2`, [eventA, sourceA]);
    assert.equal((await repository.listTimeline(publicSlug, {})).data.some((event) => event.id === eventA), false);
    await pool.query(`UPDATE public_content.institution_sources SET visibility = 'PUBLISHED' WHERE institution_slug = $1 AND source_key = $2`, [publicSlug, sourceB]);
    await pool.query(`UPDATE public_content.timeline_sources SET visibility = 'PUBLISHED' WHERE event_key = $1 AND source_key = $2`, [eventA, sourceA]);
  });

  await t.test('metadata regions follow public institutions, not synthetic seed dictionaries', async () => {
    assert.equal((await repository.metadata()).regions.some((item) => item.code === region.code), true);
    await pool.query(`UPDATE public_content.published_institutions SET visibility = 'TEMPORARILY_HIDDEN' WHERE slug = $1`, [publicSlug]);
    assert.equal((await repository.metadata()).regions.some((item) => item.code === region.code), false);
    await assert.rejects(repository.listTimeline(publicSlug, {}), (error: unknown) => error instanceof ApiError && error.statusCode === 404);
    assert.deepEqual((await repository.findSourceById(sourceA))?.institution_slugs, []);
    await pool.query(`UPDATE public_content.published_institutions SET visibility = 'PUBLISHED' WHERE slug = $1`, [publicSlug]);
    validate('PublicMetadata', await repository.metadata());
  });

  await t.test('read-only transactions reject writes and protect query snapshot', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const before = await client.query(`SELECT visibility FROM public_content.published_sources WHERE public_key = $1`, [sourceA]);
      await pool.query(`UPDATE public_content.published_sources SET visibility = 'WITHDRAWN' WHERE public_key = $1`, [sourceA]);
      const after = await client.query(`SELECT visibility FROM public_content.published_sources WHERE public_key = $1`, [sourceA]);
      assert.equal(before.rows[0]?.visibility, 'PUBLISHED');
      assert.equal(after.rows[0]?.visibility, 'PUBLISHED');
      await assert.rejects(client.query(`UPDATE public_content.published_sources SET visibility = 'DRAFT' WHERE public_key = $1`, [sourceA]), (error: unknown) => error instanceof pg.DatabaseError && error.code === '25006');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.query(`UPDATE public_content.published_sources SET visibility = 'PUBLISHED' WHERE public_key = $1`, [sourceA]);
    }
  });
});

test('PostgreSQL least-privilege runtime role cannot write or read internal drafts', { timeout: 30_000 }, async (t) => {
  const { readonlyUrl } = validateIntegrationTargets(process.env);
  const pool = new pg.Pool({ connectionString: readonlyUrl, max: 2, connectionTimeoutMillis: 5_000 });
  pool.on('error', () => {});
  t.after(async () => { await pool.end(); });
  const role = await pool.query(`SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`);
  assert.equal(role.rows[0]?.rolsuper, false);
  assert.equal(role.rows[0]?.rolcreatedb, false);
  assert.equal(role.rows[0]?.rolcreaterole, false);
  const repository = new PostgresArchiveRepository(pool);
  assert.equal(await repository.isReady(), true);
  await repository.list({ page_size: 1 });
  await repository.listSources({ page_size: 1 });
  await repository.metadata();
  const denied = (error: unknown): boolean => error instanceof pg.DatabaseError && error.code === '42501';
  await assert.rejects(pool.query('SELECT * FROM internal_content.institution_drafts LIMIT 0'), denied);
  // Explicit READ WRITE proves GRANTs deny writes independently of default_transaction_read_only.
  // WHERE false keeps these checks non-destructive even if the role is misconfigured.
  const client = await pool.connect();
  try {
    for (const sql of [
      `UPDATE public_content.published_institutions SET name = name WHERE false`,
      `INSERT INTO public_content.published_sources (public_key) SELECT 'src-fictional-no-write' WHERE false`,
    ]) {
      await client.query('BEGIN READ WRITE');
      try { await assert.rejects(client.query(sql), denied); } finally { await client.query('ROLLBACK'); }
    }
  } finally { client.release(); }
});
