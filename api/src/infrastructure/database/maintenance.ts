import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { InstitutionRecord } from '../../modules/archive/domain/institution.js';
import type { SourceRecord, TimelineRecord } from '../../modules/archive/domain/archive.js';
import { mapInstitution, mapSource, mapTimeline } from './public-mappers.js';

/** Explicit maintenance entry only; importing this module never connects or runs migrations. */
export async function migrateDatabase(pool: Pick<Pool, 'connect'>): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  let discard = false;
  try {
    await client.query('SELECT pg_advisory_lock(715394281)');
    locked = true;
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL('../../../drizzle/', import.meta.url)) });
  } finally {
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock(715394281)'); } catch { discard = true; }
    }
    client.release(discard);
  }
}

export interface SyntheticFixtures {
  readonly institutions: readonly InstitutionRecord[];
  readonly sources: readonly SourceRecord[];
  readonly timeline: readonly TimelineRecord[];
}
/** Validate the full synthetic graph before touching the database. No review identity is invented. */
function validateFixtures(fixtures: SyntheticFixtures): void {
  const institutionKeys = new Set(fixtures.institutions.map((record) => record.reviewedProjection.slug));
  const sourceKeys = new Set(fixtures.sources.map((record) => record.reviewedProjection.id));
  if (institutionKeys.size !== fixtures.institutions.length || sourceKeys.size !== fixtures.sources.length
    || new Set(fixtures.timeline.map((record) => record.reviewedProjection.id)).size !== fixtures.timeline.length) throw new Error('Invalid synthetic keys');
  for (const record of fixtures.institutions) {
    const p = record.reviewedProjection;
    if (!p.slug.startsWith('fictional-')) throw new Error('Only canonical synthetic institutions may be seeded');
    mapInstitution({
      slug: p.slug, name: p.name, aliases: p.aliases, region_code: p.region.code, region_name: p.region.name,
      region_province: p.region.province, region_city: p.region.city, operating_status: p.operating_status,
      risk_tags: p.risk_tags, evidence_status: p.evidence_status, public_summary: p.public_summary,
      source_count: 0, last_reviewed_at: p.last_reviewed_at, updated_at: p.updated_at,
    });
  }
  for (const record of fixtures.sources) {
    const p = record.reviewedProjection;
    if (!p.id.startsWith('src-fictional-') || p.institution_slugs.some((slug) => !institutionKeys.has(slug))) throw new Error('Invalid synthetic source graph');
    for (const value of [p.url, p.archive_url]) {
      if (value !== null && !['example.invalid', 'example.com', 'example.org', 'example.net'].includes(new URL(value).hostname)) throw new Error('Synthetic URLs must use reserved example domains');
    }
    mapSource({
      public_key: p.id, title: p.title, publisher: p.publisher, source_type: p.source_type, url: p.url,
      published_on: p.published_on, summary: p.summary, evidence_status: p.evidence_status,
      link_status: p.link_status, archive_url: p.archive_url, last_checked_at: p.last_checked_at, updated_at: p.updated_at,
    }, p.institution_slugs);
  }
  for (const record of fixtures.timeline) {
    const p = record.reviewedProjection;
    if (!p.id.startsWith('evt-fictional-') || !institutionKeys.has(p.institution_slug)
      || p.source_ids.some((id) => !sourceKeys.has(id))) throw new Error('Invalid synthetic event graph');
    if (p.response_status === 'linked' && !fixtures.sources.some((source) => p.source_ids.includes(source.reviewedProjection.id)
      && source.publicationState === 'PUBLISHED' && source.reviewedProjection.source_type === 'statement')) throw new Error('Synthetic linked response requires a published statement');
    mapTimeline({
      public_key: p.id, institution_slug: p.institution_slug, occurred_on: p.occurred_on, occurred_until: p.occurred_until,
      title: p.title, summary: p.summary, evidence_status: p.evidence_status, risk_tags: p.risk_tags,
      response_status: p.response_status, last_reviewed_at: p.last_reviewed_at,
    }, p.source_ids);
  }
}

/** Insert-only, idempotent synthetic seed. Existing rows/publication decisions are never overwritten. */
export async function seedSyntheticDatabase(pool: Pick<Pool, 'connect'>, fixtures: SyntheticFixtures, environment: string | undefined): Promise<void> {
  if (environment !== 'development' && environment !== 'test') throw new Error('Synthetic seed requires NODE_ENV=development or test');
  validateFixtures(fixtures);
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    for (const record of fixtures.institutions) {
      const p = record.reviewedProjection;
      await client.query(`INSERT INTO public_content.published_institutions
        (slug, name, published_at, updated_at, visibility, aliases, region_code, region_name, region_province, region_city,
         operating_status, risk_tags, evidence_status, public_summary, last_reviewed_at)
        VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (slug) DO NOTHING`,
      [p.slug, p.name, p.updated_at, record.publicationState, p.aliases, p.region.code, p.region.name, p.region.province, p.region.city,
        p.operating_status, p.risk_tags, p.evidence_status, p.public_summary, p.last_reviewed_at]);
    }
    for (const record of fixtures.sources) {
      const p = record.reviewedProjection;
      await client.query(`INSERT INTO public_content.published_sources
        (public_key, visibility, title, publisher, source_type, url, published_on, summary, evidence_status, link_status, archive_url, last_checked_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (public_key) DO NOTHING`,
      [p.id, record.publicationState, p.title, p.publisher, p.source_type, p.url, p.published_on, p.summary, p.evidence_status,
        p.link_status, p.archive_url, p.last_checked_at, p.updated_at]);
      for (const slug of p.institution_slugs) {
        await client.query(`INSERT INTO public_content.institution_sources (institution_slug, source_key, visibility)
          VALUES ($1, $2, $3) ON CONFLICT (institution_slug, source_key) DO NOTHING`, [slug, p.id, record.publicationState]);
      }
    }
    for (const record of fixtures.timeline) {
      const p = record.reviewedProjection;
      await client.query(`INSERT INTO public_content.published_timeline_events
        (public_key, institution_slug, visibility, occurred_on, occurred_until, title, summary, evidence_status, risk_tags, response_status, last_reviewed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (public_key) DO NOTHING`,
      [p.id, p.institution_slug, record.publicationState, p.occurred_on, p.occurred_until, p.title, p.summary,
        p.evidence_status, p.risk_tags, p.response_status, p.last_reviewed_at]);
      for (const sourceId of p.source_ids) {
        await client.query(`INSERT INTO public_content.timeline_sources (event_key, source_key, visibility)
          VALUES ($1, $2, $3) ON CONFLICT (event_key, source_key) DO NOTHING`, [p.id, sourceId, record.publicationState]);
      }
    }
    await client.query('COMMIT');
  } catch {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw new Error('Synthetic database seed failed');
  } finally { client.release(discard); }
}
