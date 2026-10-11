import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../../../shared/errors.js';
import { countValue, loadReferenceMetadata, mapInstitution, mapRegion, mapSource, mapTimeline, mappingError, validateMetadata, type DatabaseRow } from '../../../infrastructure/database/public-mappers.js';
import type { InstitutionQuery, InstitutionListResponse, PublicInstitution } from '../domain/institution.js';
import type { ArchiveRepository, InstitutionSourceQuery, PublicMetadata, PublicSource, ReferenceMetadata, SourceListResponse, SourceQuery, TimelineListResponse, TimelineQuery } from '../domain/archive.js';

const institutionColumns = `i.slug, i.name, i.aliases, i.region_code, i.region_name, i.region_province, i.region_city,
  i.operating_status, i.risk_tags, i.evidence_status, i.public_summary, i.last_reviewed_at, i.updated_at`;
const sourceColumns = `s.public_key, s.title, s.publisher, s.source_type, s.url, s.published_on::text,
  s.summary, s.evidence_status, s.link_status, s.archive_url, s.last_checked_at, s.updated_at`;
const eventColumns = `e.public_key, e.institution_slug, e.occurred_on::text, e.occurred_until::text,
  e.title, e.summary, e.evidence_status, e.risk_tags, e.response_status, e.last_reviewed_at`;
const sourceCount = `(SELECT count(*) FROM public_content.institution_sources ix
  JOIN public_content.published_sources sx ON sx.public_key = ix.source_key AND sx.visibility = 'PUBLISHED'
  WHERE ix.institution_slug = i.slug AND ix.visibility = 'PUBLISHED') AS source_count`;
const publicSourceRelation = `SELECT ix.source_key, ix.institution_slug
  FROM public_content.institution_sources ix
  JOIN public_content.published_institutions i ON i.slug = ix.institution_slug AND i.visibility = 'PUBLISHED'
  JOIN public_content.published_sources related_source ON related_source.public_key = ix.source_key AND related_source.visibility = 'PUBLISHED'
  WHERE ix.visibility = 'PUBLISHED'`;
const publicEventRelation = `SELECT es.event_key, ${sourceColumns}
  FROM public_content.timeline_sources es
  JOIN public_content.published_sources s ON s.public_key = es.source_key AND s.visibility = 'PUBLISHED'
  JOIN public_content.published_timeline_events e ON e.public_key = es.event_key AND e.visibility = 'PUBLISHED'
  JOIN public_content.published_institutions i ON i.slug = e.institution_slug AND i.visibility = 'PUBLISHED'
  WHERE es.visibility = 'PUBLISHED'`;
const visibleEvent = `e.visibility = 'PUBLISHED'
  AND (e.evidence_status = 'pending_verification' OR EXISTS (
    SELECT 1 FROM public_content.timeline_sources es
    JOIN public_content.published_sources s ON s.public_key = es.source_key AND s.visibility = 'PUBLISHED'
    WHERE es.event_key = e.public_key AND es.visibility = 'PUBLISHED'))
  AND (e.response_status <> 'linked' OR EXISTS (
    SELECT 1 FROM public_content.timeline_sources es
    JOIN public_content.published_sources s ON s.public_key = es.source_key AND s.visibility = 'PUBLISHED' AND s.source_type = 'statement'
    WHERE es.event_key = e.public_key AND es.visibility = 'PUBLISHED'))`;

function unavailable(): ApiError { return new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable'); }
function missing(): ApiError { return new ApiError(404, 'NOT_FOUND', 'No public resource was found'); }
function pageValues(query: { page?: number; page_size?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.page_size ?? 20;
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The request does not satisfy the API contract');
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}
function pagination(page: number, pageSize: number, total: number) {
  return { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) };
}
/** Escape LIKE metacharacters: q is a literal substring, not a wildcard expression. */
export function literalPattern(value: string): string {
  return `%${value.trim().replace(/[\\%_]/g, '\\$&')}%`;
}
class Predicate {
  readonly values: unknown[] = [];
  readonly clauses: string[];
  constructor(initial: string) { this.clauses = [initial]; }
  bind(value: unknown): string { this.values.push(value); return `$${this.values.length}`; }
  equals(column: string, value: unknown): void {
    if (value !== undefined) this.clauses.push(`${column} = ${this.bind(value)}`);
  }
  get sql(): string { return this.clauses.join(' AND '); }
}

/** Pool is injected by the composition root. No environment lookup, migration, writes or mock fallback. */
export class PostgresArchiveRepository implements ArchiveRepository {
  readonly mode = 'postgres' as const;
  private readonly reference: ReferenceMetadata;
  constructor(private readonly pool: Pick<Pool, 'connect'>, referenceMetadata: ReferenceMetadata = loadReferenceMetadata()) {
    this.reference = structuredClone(referenceMetadata);
    validateMetadata({ ...this.reference, regions: [] });
  }

  private async snapshot<T>(read: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    let discard = false;
    try {
      client = await this.pool.connect();
      // BEGIN belongs inside try/finally: even a failed BEGIN releases this checked-out client.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      const result = await read(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch { discard = true; }
      }
      // Unknown dependency errors (including connect/BEGIN/COMMIT) are safely unavailable.
      // Only deliberately tagged projection defects are INTERNAL_ERROR; do not expose driver messages.
      throw error instanceof ApiError ? error : unavailable();
    } finally {
      client?.release(discard);
    }
  }

  async isReady(): Promise<boolean> {
    try {
      await this.snapshot(async (client) => {
        await client.query(`SELECT ${institutionColumns}, ${sourceCount} FROM public_content.published_institutions i LIMIT 0`);
        await client.query(`SELECT ${sourceColumns} FROM public_content.published_sources s LIMIT 0`);
        await client.query(`SELECT ${eventColumns} FROM public_content.published_timeline_events e LIMIT 0`);
        await client.query(`${publicSourceRelation} LIMIT 0`);
        await client.query(`${publicEventRelation} LIMIT 0`);
      });
      return true;
    } catch { return false; }
  }

  async list(query: InstitutionQuery): Promise<InstitutionListResponse> {
    const { page, pageSize, offset } = pageValues(query);
    return this.snapshot(async (client) => {
      if (query.region !== undefined) {
        const region = await client.query<DatabaseRow>(`SELECT 1 FROM public_content.published_institutions
          WHERE visibility = 'PUBLISHED' AND region_code = $1 LIMIT 1`, [query.region]);
        if (region.rows.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'The request does not satisfy the API contract', [
          { field: 'region', message: 'Unknown public region code' },
        ]);
      }
      const where = new Predicate("i.visibility = 'PUBLISHED'");
      if (query.q?.trim()) {
        const keyword = where.bind(literalPattern(query.q));
        where.clauses.push(`(i.name ILIKE ${keyword} ESCAPE E'\\\\' OR EXISTS (
          SELECT 1 FROM unnest(i.aliases) AS alias(value) WHERE alias.value ILIKE ${keyword} ESCAPE E'\\\\'))`);
      }
      where.equals('i.region_code', query.region);
      if (query.risk_tag !== undefined) where.clauses.push(`i.risk_tags @> ARRAY[${where.bind(query.risk_tag)}]::text[]`);
      where.equals('i.evidence_status', query.evidence_status);
      where.equals('i.operating_status', query.operating_status);
      const order = query.sort === 'name_asc' ? 'i.name COLLATE "C" ASC' : query.sort === 'updated_asc' ? 'i.updated_at ASC' : 'i.updated_at DESC';
      const count = await client.query<DatabaseRow>(`SELECT count(*) AS total FROM public_content.published_institutions i WHERE ${where.sql}`, where.values);
      const rows = await client.query<DatabaseRow>(`SELECT ${institutionColumns}, ${sourceCount}
        FROM public_content.published_institutions i WHERE ${where.sql}
        ORDER BY ${order} NULLS LAST, i.slug COLLATE "C" ASC LIMIT $${where.values.length + 1} OFFSET $${where.values.length + 2}`,
      [...where.values, pageSize, offset]);
      return { data: rows.rows.map(mapInstitution), pagination: pagination(page, pageSize, countValue(count.rows[0]?.total)) };
    });
  }

  async findBySlug(slug: string): Promise<PublicInstitution | null> {
    return this.snapshot(async (client) => {
      const result = await client.query<DatabaseRow>(`SELECT ${institutionColumns}, ${sourceCount}
        FROM public_content.published_institutions i WHERE i.visibility = 'PUBLISHED' AND i.slug = $1`, [slug]);
      return result.rows[0] ? mapInstitution(result.rows[0]) : null;
    });
  }

  private async requireParent(client: PoolClient, slug: string): Promise<void> {
    const parent = await client.query<DatabaseRow>(`SELECT 1 FROM public_content.published_institutions WHERE visibility = 'PUBLISHED' AND slug = $1`, [slug]);
    if (parent.rows.length === 0) throw missing();
  }
  private async sourceSlugs(client: PoolClient, keys: readonly string[]): Promise<Map<string, string[]>> {
    const grouped = new Map<string, string[]>();
    if (keys.length === 0) return grouped;
    const relations = await client.query<DatabaseRow>(`${publicSourceRelation}
      AND ix.source_key = ANY($1::text[]) ORDER BY ix.source_key COLLATE "C", ix.institution_slug COLLATE "C"`, [keys]);
    for (const row of relations.rows) {
      if (typeof row.source_key !== 'string' || typeof row.institution_slug !== 'string') throw mappingError();
      const slugs = grouped.get(row.source_key) ?? [];
      slugs.push(row.institution_slug);
      grouped.set(row.source_key, slugs);
    }
    return grouped;
  }
  private async sourceList(client: PoolClient, query: SourceQuery): Promise<SourceListResponse> {
    const { page, pageSize, offset } = pageValues(query);
    const where = new Predicate("s.visibility = 'PUBLISHED'");
    if (query.q?.trim()) {
      const keyword = where.bind(literalPattern(query.q));
      where.clauses.push(`(s.title ILIKE ${keyword} ESCAPE E'\\\\' OR s.publisher ILIKE ${keyword} ESCAPE E'\\\\')`);
    }
    where.equals('s.source_type', query.source_type);
    where.equals('s.evidence_status', query.evidence_status);
    if (query.institution_slug !== undefined) {
      where.clauses.push(`EXISTS (${publicSourceRelation} AND ix.source_key = s.public_key AND ix.institution_slug = ${where.bind(query.institution_slug)})`);
    }
    const order = query.sort === 'updated_desc' ? 's.updated_at DESC' : query.sort === 'published_asc' ? 's.published_on ASC' : 's.published_on DESC';
    const count = await client.query<DatabaseRow>(`SELECT count(*) AS total FROM public_content.published_sources s WHERE ${where.sql}`, where.values);
    const result = await client.query<DatabaseRow>(`SELECT ${sourceColumns} FROM public_content.published_sources s WHERE ${where.sql}
      ORDER BY ${order} NULLS LAST, s.public_key COLLATE "C" ASC LIMIT $${where.values.length + 1} OFFSET $${where.values.length + 2}`,
    [...where.values, pageSize, offset]);
    const keys = result.rows.map((row) => {
      if (typeof row.public_key !== 'string') throw mappingError();
      return row.public_key;
    });
    const slugs = await this.sourceSlugs(client, keys);
    return { data: result.rows.map((row, index) => mapSource(row, slugs.get(keys[index] ?? '') ?? [])), pagination: pagination(page, pageSize, countValue(count.rows[0]?.total)) };
  }
  async listSources(query: SourceQuery): Promise<SourceListResponse> {
    return this.snapshot((client) => this.sourceList(client, query));
  }
  async listInstitutionSources(slug: string, query: InstitutionSourceQuery): Promise<SourceListResponse> {
    return this.snapshot(async (client) => {
      await this.requireParent(client, slug);
      return this.sourceList(client, { ...query, institution_slug: slug });
    });
  }
  async findSourceById(id: string): Promise<PublicSource | null> {
    return this.snapshot(async (client) => {
      const result = await client.query<DatabaseRow>(`SELECT ${sourceColumns} FROM public_content.published_sources s WHERE s.visibility = 'PUBLISHED' AND s.public_key = $1`, [id]);
      const row = result.rows[0];
      if (!row) return null;
      const slugs = await this.sourceSlugs(client, [id]);
      return mapSource(row, slugs.get(id) ?? []);
    });
  }

  async listTimeline(slug: string, query: TimelineQuery): Promise<TimelineListResponse> {
    const { page, pageSize, offset } = pageValues(query);
    return this.snapshot(async (client) => {
      await this.requireParent(client, slug);
      const where = `${visibleEvent} AND e.institution_slug = $1`;
      const count = await client.query<DatabaseRow>(`SELECT count(*) AS total FROM public_content.published_timeline_events e WHERE ${where}`, [slug]);
      const rows = await client.query<DatabaseRow>(`SELECT ${eventColumns} FROM public_content.published_timeline_events e WHERE ${where}
        ORDER BY e.occurred_on ${query.sort === 'date_asc' ? 'ASC' : 'DESC'} NULLS LAST, e.public_key COLLATE "C" ASC LIMIT $2 OFFSET $3`, [slug, pageSize, offset]);
      const keys = rows.rows.map((row) => {
        if (typeof row.public_key !== 'string') throw mappingError();
        return row.public_key;
      });
      const sources = keys.length > 0 ? await client.query<DatabaseRow>(`${publicEventRelation}
        AND es.event_key = ANY($1::text[]) ORDER BY es.event_key COLLATE "C", s.public_key COLLATE "C"`, [keys]) : { rows: [] };
      const grouped = new Map<string, PublicSource[]>();
      for (const row of sources.rows) {
        if (typeof row.event_key !== 'string') throw mappingError();
        const items = grouped.get(row.event_key) ?? [];
        items.push(mapSource(row, []));
        grouped.set(row.event_key, items);
      }
      return {
        data: rows.rows.map((row) => {
          const publicSources = grouped.get(String(row.public_key)) ?? [];
          if (row.response_status === 'linked' && !publicSources.some((source) => source.source_type === 'statement')) throw mappingError();
          return mapTimeline(row, publicSources.map((source) => source.id));
        }),
        pagination: pagination(page, pageSize, countValue(count.rows[0]?.total)),
      };
    });
  }

  async metadata(): Promise<PublicMetadata> {
    return this.snapshot(async (client) => {
      const rows = await client.query<DatabaseRow>(`SELECT region_code, region_name, region_province, region_city FROM (
        SELECT DISTINCT region_code, region_name, region_province, region_city
        FROM public_content.published_institutions WHERE visibility = 'PUBLISHED'
      ) regions ORDER BY region_code COLLATE "C"`);
      const value: PublicMetadata = {
        contract_version: this.reference.contract_version, regions: rows.rows.map(mapRegion),
        evidence_statuses: structuredClone(this.reference.evidence_statuses), risk_tags: structuredClone(this.reference.risk_tags),
        operating_statuses: structuredClone(this.reference.operating_statuses), source_types: structuredClone(this.reference.source_types),
      };
      validateMetadata(value);
      return value;
    });
  }
}
