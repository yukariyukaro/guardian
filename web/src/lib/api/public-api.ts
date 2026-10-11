import type { components, operations } from './schema';

export type InstitutionListParams = NonNullable<
  operations['listPublicInstitutions']['parameters']['query']
>;
export type TimelineListParams = NonNullable<
  operations['listPublicInstitutionTimeline']['parameters']['query']
>;
export type InstitutionSourceListParams = NonNullable<
  operations['listPublicInstitutionSources']['parameters']['query']
>;
export type InstitutionDto = components['schemas']['PublicInstitution'];
export type MetadataDto = components['schemas']['PublicMetadata'];
export type SourceDto = components['schemas']['PublicSource'];
export type TimelineDto = components['schemas']['PublicTimelineEvent'];
export type PaginationDto = components['schemas']['Pagination'];

export interface PublicApi {
  list(
    params: InstitutionListParams,
    signal?: AbortSignal,
  ): Promise<components['schemas']['InstitutionListResponse']>;
  get(
    slug: string,
    signal?: AbortSignal,
  ): Promise<components['schemas']['InstitutionDetailResponse']>;
  metadata(signal?: AbortSignal): Promise<components['schemas']['MetadataResponse']>;
  timeline(
    slug: string,
    params: TimelineListParams,
    signal?: AbortSignal,
  ): Promise<components['schemas']['TimelineListResponse']>;
  sources(
    slug: string,
    params: InstitutionSourceListParams,
    signal?: AbortSignal,
  ): Promise<components['schemas']['SourceListResponse']>;
  source(id: string, signal?: AbortSignal): Promise<components['schemas']['SourceDetailResponse']>;
}
