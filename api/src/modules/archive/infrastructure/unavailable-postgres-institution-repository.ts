import { ApiError } from '../../../shared/errors.js';
import type { InstitutionQuery, InstitutionListResponse, PublicInstitution } from '../domain/institution.js';
import type { ArchiveRepository, SourceQuery, InstitutionSourceQuery, TimelineQuery, PublicSource, PublicMetadata, SourceListResponse, TimelineListResponse } from '../domain/archive.js';

function unavailable(): never { throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable'); }

/** Missing connection configuration remains unavailable, never a mock fallback. */
export class UnavailablePostgresInstitutionRepository implements ArchiveRepository {
  readonly mode = 'postgres' as const;
  async isReady(): Promise<boolean> { return false; }
  async list(_query: InstitutionQuery): Promise<InstitutionListResponse> { return unavailable(); }
  async findBySlug(_slug: string): Promise<PublicInstitution | null> { return unavailable(); }
  async listSources(_query: SourceQuery): Promise<SourceListResponse> { return unavailable(); }
  async findSourceById(_id: string): Promise<PublicSource | null> { return unavailable(); }
  async listInstitutionSources(_slug: string, _query: InstitutionSourceQuery): Promise<SourceListResponse> { return unavailable(); }
  async listTimeline(_slug: string, _query: TimelineQuery): Promise<TimelineListResponse> { return unavailable(); }
  async metadata(): Promise<PublicMetadata> { return unavailable(); }
}
