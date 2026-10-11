import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as addFormatsImport } from 'ajv-formats';
import { componentSchema, loadContract, resolveSchema, type JsonObject } from '../openapi/contract.js';
import { ApiError } from '../../shared/errors.js';
import { publicUrl, type PublicMetadata, type PublicRegion, type PublicSource, type PublicTimelineEvent, type ReferenceMetadata } from '../../modules/archive/domain/archive.js';
import type { PublicInstitution } from '../../modules/archive/domain/institution.js';

export type DatabaseRow = Record<string, unknown>;
const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;
const contract = loadContract();
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: false }));
const institutionValidator = ajv.compile<PublicInstitution>(componentSchema(contract, 'PublicInstitution'));
const sourceValidator = ajv.compile<PublicSource>(componentSchema(contract, 'PublicSource'));
const timelineValidator = ajv.compile<PublicTimelineEvent>(componentSchema(contract, 'PublicTimelineEvent'));
const regionValidator = ajv.compile<PublicRegion>(componentSchema(contract, 'PublicRegion'));
const metadataValidator = ajv.compile<PublicMetadata>(componentSchema(contract, 'PublicMetadata'));

export function mappingError(): ApiError {
  return new ApiError(500, 'INTERNAL_ERROR', 'The service is temporarily unavailable');
}
function timestamp(value: unknown): unknown {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw mappingError();
    return value.toISOString();
  }
  return value;
}
export function mapRegion(row: DatabaseRow): PublicRegion {
  const region: unknown = { code: row.region_code, name: row.region_name, province: row.region_province, city: row.region_city };
  if (!regionValidator(region)) throw mappingError();
  return region;
}
export function countValue(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) throw mappingError();
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw mappingError();
  return count;
}
export function mapInstitution(row: DatabaseRow): PublicInstitution {
  const value: unknown = {
    slug: row.slug, name: row.name, aliases: row.aliases, region: mapRegion(row),
    operating_status: row.operating_status, risk_tags: row.risk_tags, evidence_status: row.evidence_status,
    public_summary: row.public_summary, source_count: countValue(row.source_count),
    last_reviewed_at: timestamp(row.last_reviewed_at), updated_at: timestamp(row.updated_at),
  };
  if (!institutionValidator(value)) throw mappingError();
  return value;
}
export function mapSource(row: DatabaseRow, institutionSlugs: readonly string[]): PublicSource {
  const value: unknown = {
    id: row.public_key, title: row.title, publisher: row.publisher, source_type: row.source_type,
    url: row.url, published_on: row.published_on, summary: row.summary, evidence_status: row.evidence_status,
    link_status: row.link_status, archive_url: row.archive_url, institution_slugs: [...institutionSlugs],
    last_checked_at: timestamp(row.last_checked_at), updated_at: timestamp(row.updated_at),
  };
  if (!sourceValidator(value) || !publicUrl(value.url) || (value.archive_url !== null && !publicUrl(value.archive_url))) throw mappingError();
  return value;
}
export function mapTimeline(row: DatabaseRow, sourceIds: readonly string[]): PublicTimelineEvent {
  const value: unknown = {
    id: row.public_key, institution_slug: row.institution_slug,
    occurred_on: row.occurred_on, occurred_until: row.occurred_until,
    title: row.title, summary: row.summary, evidence_status: row.evidence_status, risk_tags: row.risk_tags,
    source_ids: [...sourceIds], response_status: row.response_status, last_reviewed_at: timestamp(row.last_reviewed_at),
  };
  if (!timelineValidator(value)) throw mappingError();
  if (value.occurred_until !== null && (value.occurred_on === null || value.occurred_until < value.occurred_on)) throw mappingError();
  if (value.evidence_status !== 'pending_verification' && value.source_ids.length === 0) throw mappingError();
  return value;
}

/** Select only non-regional display dictionaries from the contract, never its fictional regions. */
export function loadReferenceMetadata(document: JsonObject = contract): ReferenceMetadata {
  const raw = resolveSchema(document, { $ref: '#/components/examples/Metadata' });
  if (raw === null || typeof raw !== 'object' || !('value' in raw)) throw mappingError();
  const envelope = raw.value;
  if (envelope === null || typeof envelope !== 'object' || !('data' in envelope)) throw mappingError();
  const data = envelope.data;
  if (data === null || typeof data !== 'object') throw mappingError();
  const dictionaries = Object.fromEntries(['evidence_statuses', 'risk_tags', 'operating_statuses', 'source_types'].map((key) => {
    const entries = Reflect.get(data, key);
    if (!Array.isArray(entries)) throw mappingError();
    return [key, entries.map((entry: unknown) => {
      if (entry === null || typeof entry !== 'object') throw mappingError();
      return { value: Reflect.get(entry, 'value'), label: Reflect.get(entry, 'label'), description: Reflect.get(entry, 'description') };
    })];
  }));
  const info = document.info;
  if (info === null || typeof info !== 'object') throw mappingError();
  const value: unknown = { contract_version: Reflect.get(info, 'version'), regions: [], ...dictionaries };
  if (!metadataValidator(value)) throw mappingError();
  validateMetadata(value, document);
  return {
    contract_version: value.contract_version, evidence_statuses: value.evidence_statuses,
    risk_tags: value.risk_tags, operating_statuses: value.operating_statuses, source_types: value.source_types,
  };
}
export function validateMetadata(value: PublicMetadata, document: JsonObject = contract): void {
  if (!metadataValidator(value)) throw mappingError();
  for (const [key, schema] of [
    ['evidence_statuses', 'EvidenceStatus'], ['risk_tags', 'RiskTag'],
    ['operating_statuses', 'OperatingStatus'], ['source_types', 'SourceType'],
  ] as const) {
    const expected = componentSchema(document, schema).enum;
    const actual = value[key].map((entry) => entry.value);
    if (!Array.isArray(expected) || actual.length !== expected.length || new Set(actual).size !== actual.length
      || !expected.every((entry) => actual.some((candidate) => candidate === entry))) throw mappingError();
  }
  if (new Set(value.regions.map((region) => region.code)).size !== value.regions.length) throw mappingError();
}
