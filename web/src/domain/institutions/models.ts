// Domain models are intentionally camelCase; API DTOs are generated separately.
export const evidenceStatuses = [
  'official_record',
  'multiple_sources',
  'single_source',
  'first_person_statement',
  'pending_verification',
] as const;
export const operatingStatuses = ['operating', 'closed', 'relocated', 'unknown'] as const;
export const riskTags = [
  'physical_abuse',
  'restriction_of_freedom',
  'medical_practices',
  'fee_dispute',
  'regulatory_action',
  'judicial_record',
  'name_or_location_change',
  'no_public_response',
] as const;
export const institutionSorts = ['updated_desc', 'updated_asc', 'name_asc'] as const;
export type EvidenceStatus = (typeof evidenceStatuses)[number];
export type OperatingStatus = (typeof operatingStatuses)[number];
export type RiskTag = (typeof riskTags)[number];
export type InstitutionSort = (typeof institutionSorts)[number];

export interface InstitutionQuery {
  q: string;
  region: string;
  riskTag: RiskTag | '';
  evidenceStatus: EvidenceStatus | '';
  operatingStatus: OperatingStatus | '';
  sort: InstitutionSort;
  page: number;
  pageSize: number;
}
export interface Institution {
  slug: string;
  name: string;
  aliases: readonly string[];
  regionCode: string;
  regionName: string;
  operatingStatus: OperatingStatus;
  riskTags: readonly RiskTag[];
  evidenceStatus: EvidenceStatus;
  summary: string;
  sourceCount: number;
  reviewedAt: string;
  updatedAt: string;
}
export interface PageResult<T> {
  records: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface DictionaryEntry<T extends string = string> {
  value: T;
  label: string;
  description: string;
}
export interface ArchiveMetadata {
  regions: DictionaryEntry[];
  evidenceStatuses: DictionaryEntry<EvidenceStatus>[];
  riskTags: DictionaryEntry<RiskTag>[];
  operatingStatuses: DictionaryEntry<OperatingStatus>[];
}
export interface TimelineEvent {
  id: string;
  date: string | null;
  endDate: string | null;
  title: string;
  summary: string;
  evidenceStatus: EvidenceStatus;
  sourceIds: readonly string[];
  responseStatus: 'none' | 'available' | 'linked';
}
export interface RelatedPageQuery {
  page: number;
  pageSize: number;
}
export interface InstitutionDossier {
  institution: Institution;
  timeline: PageResult<TimelineEvent>;
  sources: PageResult<Source>;
}
export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedOn: string | null;
  summary: string;
  linkStatus: 'unchecked' | 'accessible' | 'redirected' | 'unavailable' | 'manual_review';
  evidenceStatus: EvidenceStatus;
}
export interface InstitutionRepository {
  list(query: InstitutionQuery, signal?: AbortSignal): Promise<PageResult<Institution>>;
  get(slug: string, signal?: AbortSignal): Promise<Institution>;
  metadata(signal?: AbortSignal): Promise<ArchiveMetadata>;
  timeline(
    slug: string,
    query: RelatedPageQuery,
    signal?: AbortSignal,
  ): Promise<PageResult<TimelineEvent>>;
  sources(slug: string, query: RelatedPageQuery, signal?: AbortSignal): Promise<PageResult<Source>>;
  source(id: string, signal?: AbortSignal): Promise<Source>;
}
