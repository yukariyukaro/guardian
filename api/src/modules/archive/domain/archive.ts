import type { components, operations } from '../../../infrastructure/openapi/generated.js';
import type { InstitutionRepository, PublicationState } from './institution.js';

export type PublicSource = components['schemas']['PublicSource'];
export type PublicTimelineEvent = components['schemas']['PublicTimelineEvent'];
export type PublicMetadata = components['schemas']['PublicMetadata'];
export type PublicRegion = components['schemas']['PublicRegion'];
export type SourceQuery = NonNullable<operations['listPublicSources']['parameters']['query']>;
export type InstitutionSourceQuery = NonNullable<operations['listPublicInstitutionSources']['parameters']['query']>;
export type TimelineQuery = NonNullable<operations['listPublicInstitutionTimeline']['parameters']['query']>;
export type SourceListResponse = components['schemas']['SourceListResponse'];
export type SourceDetailResponse = components['schemas']['SourceDetailResponse'];
export type TimelineListResponse = components['schemas']['TimelineListResponse'];
export type MetadataResponse = components['schemas']['MetadataResponse'];
export type ReferenceMetadata = Omit<PublicMetadata, 'regions'>;

export interface SourceRecord {
  readonly publicationState: PublicationState;
  readonly reviewedProjection: PublicSource;
}
export interface TimelineRecord {
  readonly publicationState: PublicationState;
  readonly reviewedProjection: PublicTimelineEvent;
}
export interface ArchiveRepository extends InstitutionRepository {
  listSources(query: SourceQuery): Promise<SourceListResponse>;
  findSourceById(id: string): Promise<PublicSource | null>;
  listInstitutionSources(slug: string, query: InstitutionSourceQuery): Promise<SourceListResponse>;
  listTimeline(slug: string, query: TimelineQuery): Promise<TimelineListResponse>;
  metadata(): Promise<PublicMetadata>;
}

function hasSensitiveParameters(value: string): boolean {
  // URLSearchParams decodes parameter names; ignore case and common separators.
  const parameters = new URLSearchParams(value.replace(/[?;]/g, '&'));
  for (const name of parameters.keys()) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/^(?:xamz|xgoog)/.test(key)
      || /(?:token|secret|password|passwd|credential|signature|passphrase|authorization|session|apikey)/.test(key)
      || /^(?:auth|authorization|bearer|jwt|session|sessionid|sid|pwd|pass|sig|sign|signed|key|apikey|accesskey|authkey|privatekey|awsaccesskeyid|googleaccessid|code|authcode|oauthcode)$/.test(key)) return true;
  }
  return false;
}

function publicHost(host: string): boolean {
  if (host.endsWith('.') || host.startsWith('[') || !host.includes('.')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number);
    if (a === undefined || b === undefined || c === undefined) return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  return host.length <= 253
    && host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && !/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|home\.arpa)$/.test(host);
}

export function publicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // WHATWG URL normalizes case, IDNA dots and alternate IPv4 spellings.
    // Reject trailing DNS dots rather than letting local-name checks be bypassed.
    const host = url.hostname.toLowerCase();
    const fragment = decodeURIComponent(url.hash.slice(1));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && !hasSensitiveParameters(url.search.slice(1))
      && !hasSensitiveParameters(fragment)
      && publicHost(host);
  } catch { return false; }
}

export function projectSource(record: SourceRecord, publicSlugs: ReadonlySet<string>): PublicSource | null {
  if (record.publicationState !== 'PUBLISHED') return null;
  const source = record.reviewedProjection;
  if (!publicUrl(source.url) || (source.archive_url !== null && !publicUrl(source.archive_url))) return null;
  return {
    id: source.id, title: source.title, publisher: source.publisher, source_type: source.source_type,
    url: source.url, published_on: source.published_on, summary: source.summary,
    evidence_status: source.evidence_status, link_status: source.link_status, archive_url: source.archive_url,
    institution_slugs: [...new Set(source.institution_slugs.filter((slug) => publicSlugs.has(slug)))].sort(),
    last_checked_at: source.last_checked_at, updated_at: source.updated_at,
  };
}

export function projectTimeline(record: TimelineRecord, sources: ReadonlyMap<string, PublicSource>): PublicTimelineEvent | null {
  if (record.publicationState !== 'PUBLISHED') return null;
  const event = record.reviewedProjection;
  if (event.occurred_until !== null && (event.occurred_on === null || event.occurred_until < event.occurred_on)) return null;
  const sourceIds = [...new Set(event.source_ids.filter((id) => sources.has(id)))].sort();
  if (event.evidence_status !== 'pending_verification' && sourceIds.length === 0) return null;
  if (event.response_status === 'linked' && !sourceIds.some((id) => sources.get(id)?.source_type === 'statement')) return null;
  return {
    id: event.id, institution_slug: event.institution_slug, occurred_on: event.occurred_on,
    occurred_until: event.occurred_until, title: event.title, summary: event.summary,
    evidence_status: event.evidence_status, risk_tags: [...event.risk_tags], source_ids: sourceIds,
    response_status: event.response_status, last_reviewed_at: event.last_reviewed_at,
  };
}
