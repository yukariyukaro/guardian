import { ApiError } from '../../../shared/errors.js';
import { projectInstitution, type InstitutionQuery, type InstitutionRecord, type InstitutionListResponse, type PublicInstitution } from '../domain/institution.js';
import { projectSource, projectTimeline, type ArchiveRepository, type SourceRecord, type TimelineRecord, type ReferenceMetadata, type SourceQuery, type InstitutionSourceQuery, type TimelineQuery, type PublicSource, type PublicMetadata, type SourceListResponse, type TimelineListResponse } from '../domain/archive.js';
import { loadContract } from '../../../infrastructure/openapi/contract.js';
import { createArchiveFixtures } from './fixtures.js';

const compare = (a: string, b: string): number => a === b ? 0 : a < b ? -1 : 1;
function dateCompare(a: string | null, b: string | null, asc: boolean): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return compare(a, b) * (asc ? 1 : -1);
}
function timestampCompare(a: string, b: string, asc: boolean): number {
  const difference = Date.parse(a) - Date.parse(b);
  if (!Number.isFinite(difference)) throw new ApiError(500, 'INTERNAL_ERROR', 'The service is temporarily unavailable');
  return difference * (asc ? 1 : -1);
}
function paginate<T>(data: T[], query: { page?: number; page_size?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.page_size ?? 20;
  return { data: data.slice((page - 1) * pageSize, page * pageSize), pagination: {
    page, page_size: pageSize, total: data.length, total_pages: Math.ceil(data.length / pageSize),
  } };
}

export class InMemoryInstitutionRepository implements ArchiveRepository {
  readonly mode = 'mock' as const;
  private readonly records: InstitutionRecord[];
  private readonly sourceRecords: SourceRecord[];
  private readonly timelineRecords: TimelineRecord[];
  private readonly reference: ReferenceMetadata;

  constructor(records: readonly InstitutionRecord[], options?: {
    sources: readonly SourceRecord[]; timeline: readonly TimelineRecord[]; referenceMetadata: ReferenceMetadata;
  }) {
    const fallback = options ?? createArchiveFixtures(loadContract());
    this.records = structuredClone([...records]);
    this.sourceRecords = structuredClone([...fallback.sources]);
    this.timelineRecords = structuredClone([...fallback.timeline]);
    this.reference = structuredClone(fallback.referenceMetadata);
  }
  async isReady(): Promise<boolean> { return true; }
  private institutions(): PublicInstitution[] {
    const records = this.records.flatMap((record) => { const dto = projectInstitution(record); return dto ? [dto] : []; });
    const sources = this.sources(new Set(records.map((record) => record.slug)));
    return records.map((dto) => ({ ...dto, source_count: sources.filter((source) => source.institution_slugs.includes(dto.slug)).length }));
  }
  private sources(slugs?: ReadonlySet<string>): PublicSource[] {
    const publicSlugs = slugs ?? new Set(this.records.filter((record) => record.publicationState === 'PUBLISHED').map((record) => record.reviewedProjection.slug));
    return this.sourceRecords.flatMap((record) => { const dto = projectSource(record, publicSlugs); return dto ? [dto] : []; });
  }
  async findBySlug(slug: string): Promise<PublicInstitution | null> {
    return this.institutions().find((entry) => entry.slug === slug) ?? null;
  }
  async list(query: InstitutionQuery): Promise<InstitutionListResponse> {
    const visible = this.institutions();
    if (query.region !== undefined && !visible.some((entry) => entry.region.code === query.region)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'The request does not satisfy the API contract', [{ field: 'region', message: 'Unknown public region code' }]);
    }
    const q = query.q?.trim().toLocaleLowerCase('zh-CN') ?? '';
    const filtered = visible.filter((entry) =>
      (!q || [entry.name, ...entry.aliases].some((name) => name.toLocaleLowerCase('zh-CN').includes(q)))
      && (query.region === undefined || entry.region.code === query.region)
      && (query.risk_tag === undefined || entry.risk_tags.includes(query.risk_tag))
      && (query.evidence_status === undefined || entry.evidence_status === query.evidence_status)
      && (query.operating_status === undefined || entry.operating_status === query.operating_status));
    filtered.sort((a, b) => (query.sort === 'name_asc' ? compare(a.name, b.name) : timestampCompare(a.updated_at, b.updated_at, query.sort === 'updated_asc')) || compare(a.slug, b.slug));
    return paginate(filtered, query);
  }
  async findSourceById(id: string): Promise<PublicSource | null> { return this.sources().find((source) => source.id === id) ?? null; }
  async listSources(query: SourceQuery): Promise<SourceListResponse> {
    const q = query.q?.trim().toLocaleLowerCase('zh-CN') ?? '';
    const filtered = this.sources().filter((source) =>
      (!q || [source.title, source.publisher].some((text) => text.toLocaleLowerCase('zh-CN').includes(q)))
      && (query.institution_slug === undefined || source.institution_slugs.includes(query.institution_slug))
      && (query.source_type === undefined || source.source_type === query.source_type)
      && (query.evidence_status === undefined || source.evidence_status === query.evidence_status));
    filtered.sort((a, b) => (query.sort === 'updated_desc' ? timestampCompare(a.updated_at, b.updated_at, false) : dateCompare(a.published_on, b.published_on, query.sort === 'published_asc')) || compare(a.id, b.id));
    return paginate(filtered, query);
  }
  async listInstitutionSources(slug: string, query: InstitutionSourceQuery): Promise<SourceListResponse> {
    if (!await this.findBySlug(slug)) throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found');
    return this.listSources({ ...query, institution_slug: slug });
  }
  async listTimeline(slug: string, query: TimelineQuery): Promise<TimelineListResponse> {
    if (!await this.findBySlug(slug)) throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found');
    const sources = new Map(this.sources().map((source) => [source.id, source]));
    const events = this.timelineRecords.filter((record) => record.reviewedProjection.institution_slug === slug)
      .flatMap((record) => { const dto = projectTimeline(record, sources); return dto ? [dto] : []; });
    events.sort((a, b) => dateCompare(a.occurred_on, b.occurred_on, query.sort === 'date_asc') || compare(a.id, b.id));
    return paginate(events, query);
  }
  async metadata(): Promise<PublicMetadata> {
    const regions = new Map(this.institutions().map((record) => [record.region.code, record.region]));
    return { ...structuredClone(this.reference), regions: [...regions.values()].sort((a, b) => compare(a.code, b.code)) };
  }
}
