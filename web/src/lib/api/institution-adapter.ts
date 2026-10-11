import type {
  ArchiveMetadata,
  Institution,
  InstitutionQuery,
  InstitutionRepository,
  PageResult,
  Source,
  TimelineEvent,
} from '../../domain/institutions/models';
import type { InstitutionDto, PaginationDto, PublicApi, SourceDto } from './public-api';
import { ArchiveError } from '../../domain/institutions/errors';

function institution(dto: InstitutionDto): Institution {
  // Explicit whitelist mapping: extra fields can never enter the domain model.
  return {
    slug: dto.slug,
    name: dto.name,
    aliases: [...dto.aliases],
    regionCode: dto.region.code,
    regionName: dto.region.name,
    operatingStatus: dto.operating_status,
    riskTags: [...dto.risk_tags],
    evidenceStatus: dto.evidence_status,
    summary: dto.public_summary,
    sourceCount: dto.source_count,
    reviewedAt: dto.last_reviewed_at,
    updatedAt: dto.updated_at,
  };
}
function source(dto: SourceDto): Source {
  return {
    id: dto.id,
    title: dto.title,
    publisher: dto.publisher,
    url: dto.url,
    publishedOn: dto.published_on,
    summary: dto.summary,
    linkStatus: dto.link_status,
    evidenceStatus: dto.evidence_status,
  };
}
function page<T>(records: T[], pagination: PaginationDto): PageResult<T> {
  return {
    records,
    page: pagination.page,
    pageSize: pagination.page_size,
    total: pagination.total,
    totalPages: pagination.total_pages,
  };
}
export function createInstitutionAdapter(api: PublicApi): InstitutionRepository {
  return {
    async list(query: InstitutionQuery, signal) {
      const result = await api.list(
        {
          q: query.q,
          page: query.page,
          page_size: query.pageSize,
          sort: query.sort,
          ...(query.region ? { region: query.region } : {}),
          ...(query.riskTag ? { risk_tag: query.riskTag } : {}),
          ...(query.evidenceStatus ? { evidence_status: query.evidenceStatus } : {}),
          ...(query.operatingStatus ? { operating_status: query.operatingStatus } : {}),
        },
        signal,
      );
      if (result.pagination.page !== query.page || result.pagination.page_size !== query.pageSize)
        throw new ArchiveError('invalid-response');
      return page(result.data.map(institution), result.pagination);
    },
    async get(slug, signal) {
      const { data } = await api.get(slug, signal);
      if (data.slug !== slug) throw new ArchiveError('invalid-response');
      return institution(data);
    },
    async metadata(signal): Promise<ArchiveMetadata> {
      const { data } = await api.metadata(signal);
      return {
        regions: data.regions.map((region) => ({
          value: region.code,
          label: region.name,
          description: '仅展示粗粒度地区。',
        })),
        evidenceStatuses: data.evidence_statuses.map((entry) => ({ ...entry })),
        riskTags: data.risk_tags.map((entry) => ({ ...entry })),
        operatingStatuses: data.operating_statuses.map((entry) => ({ ...entry })),
      };
    },
    async timeline(slug, query, signal): Promise<PageResult<TimelineEvent>> {
      const result = await api.timeline(
        slug,
        { page: query.page, page_size: query.pageSize },
        signal,
      );
      if (
        result.pagination.page !== query.page ||
        result.pagination.page_size !== query.pageSize ||
        result.data.some((event) => event.institution_slug !== slug)
      )
        throw new ArchiveError('invalid-response');
      return page(
        result.data.map((dto) => ({
          id: dto.id,
          date: dto.occurred_on,
          endDate: dto.occurred_until,
          title: dto.title,
          summary: dto.summary,
          evidenceStatus: dto.evidence_status,
          sourceIds: [...dto.source_ids],
          responseStatus: dto.response_status,
        })),
        result.pagination,
      );
    },
    async sources(slug, query, signal): Promise<PageResult<Source>> {
      const result = await api.sources(
        slug,
        { page: query.page, page_size: query.pageSize },
        signal,
      );
      if (
        result.pagination.page !== query.page ||
        result.pagination.page_size !== query.pageSize ||
        result.data.some((entry) => !entry.institution_slugs.includes(slug))
      )
        throw new ArchiveError('invalid-response');
      return page(result.data.map(source), result.pagination);
    },
    async source(id, signal) {
      const { data } = await api.source(id, signal);
      if (data.id !== id) throw new ArchiveError('invalid-response');
      return source(data);
    },
  };
}
