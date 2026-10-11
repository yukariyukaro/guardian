import type { components, operations } from '../../../infrastructure/openapi/generated.js';
import type { DataAdapter } from '../../../config.js';

export type PublicInstitution = components['schemas']['PublicInstitution'];
export type InstitutionListResponse = components['schemas']['InstitutionListResponse'];
export type InstitutionDetailResponse = components['schemas']['InstitutionDetailResponse'];
export type InstitutionQuery = NonNullable<operations['listPublicInstitutions']['parameters']['query']>;
export type InstitutionParams = operations['getPublicInstitution']['parameters']['path'];

// Internal state is deliberately not part of a public contract or DTO.
export type PublicationState = 'DRAFT' | 'PUBLISHED' | 'TEMPORARILY_HIDDEN' | 'WITHDRAWN';
export interface InstitutionRecord {
  readonly internalId: string;
  readonly publicationState: PublicationState;
  readonly reviewedProjection: PublicInstitution;
  readonly internalNotes: string;
}

export interface InstitutionRepository {
  readonly mode: DataAdapter;
  isReady(): Promise<boolean>;
  list(query: InstitutionQuery): Promise<InstitutionListResponse>;
  findBySlug(slug: string): Promise<PublicInstitution | null>;
}

/** Explicit allowlist mapping: never serialize a record/entity or spread an internal object. */
export function projectInstitution(record: InstitutionRecord): PublicInstitution | null {
  if (record.publicationState !== 'PUBLISHED') return null;
  const source = record.reviewedProjection;
  return {
    slug: source.slug,
    name: source.name,
    aliases: [...source.aliases],
    region: {
      code: source.region.code,
      name: source.region.name,
      province: source.region.province,
      city: source.region.city,
    },
    operating_status: source.operating_status,
    risk_tags: [...source.risk_tags],
    evidence_status: source.evidence_status,
    public_summary: source.public_summary,
    source_count: source.source_count,
    last_reviewed_at: source.last_reviewed_at,
    updated_at: source.updated_at,
  };
}
