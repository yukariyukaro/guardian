import { ApiError } from '../../../shared/errors.js';
import type { InstitutionDetailResponse, InstitutionListResponse, InstitutionQuery, InstitutionRepository } from '../domain/institution.js';
import type { ArchiveRepository, SourceQuery, InstitutionSourceQuery, TimelineQuery, SourceListResponse, SourceDetailResponse, TimelineListResponse, MetadataResponse } from '../domain/archive.js';

export class InstitutionService {
  constructor(private readonly repository: InstitutionRepository) {}
  list(query: InstitutionQuery): Promise<InstitutionListResponse> { return this.repository.list(query); }
  async detail(slug: string): Promise<InstitutionDetailResponse> {
    const data = await this.repository.findBySlug(slug);
    if (data === null) throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found');
    return { data };
  }
}

export class ArchiveService extends InstitutionService {
  constructor(private readonly archive: ArchiveRepository) { super(archive); }
  listSources(query: SourceQuery): Promise<SourceListResponse> { return this.archive.listSources(query); }
  async source(id: string): Promise<SourceDetailResponse> {
    const data = await this.archive.findSourceById(id);
    if (data === null) throw new ApiError(404, 'NOT_FOUND', 'The requested resource was not found');
    return { data };
  }
  institutionSources(slug: string, query: InstitutionSourceQuery): Promise<SourceListResponse> { return this.archive.listInstitutionSources(slug, query); }
  timeline(slug: string, query: TimelineQuery): Promise<TimelineListResponse> { return this.archive.listTimeline(slug, query); }
  async metadata(): Promise<MetadataResponse> { return { data: await this.archive.metadata() }; }
}
