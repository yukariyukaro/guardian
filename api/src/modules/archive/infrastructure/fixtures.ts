import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as addFormatsImport } from 'ajv-formats';
import { componentSchema, resolveSchema, type JsonObject } from '../../../infrastructure/openapi/contract.js';
import type { InstitutionRecord, PublicInstitution } from '../domain/institution.js';
import type { PublicSource, PublicTimelineEvent, PublicMetadata, ReferenceMetadata, SourceRecord, TimelineRecord } from '../domain/archive.js';

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;

/** Use the canonical synthetic example; do not import real institutions or production records. */
export function createFictionalRecords(contract: JsonObject): InstitutionRecord[] {
  const raw = resolveSchema(contract, { $ref: '#/components/examples/InstitutionDetail' }) as JsonObject;
  const value = raw.value as { data: unknown };
  const validate = addFormats(new Ajv2020({ strict: false })).compile(componentSchema(contract, 'PublicInstitution'));
  if (!validate(value.data)) {
    throw new Error('The canonical fictional institution example is invalid');
  }
  const projection = value.data as PublicInstitution;
  const base = {
    reviewedProjection: structuredClone(projection),
    internalNotes: 'Synthetic private note: must never appear in API responses',
  };
  return [
    { ...base, internalId: '00000000-0000-4000-8000-000000000001', publicationState: 'PUBLISHED' },
    ...(['DRAFT', 'TEMPORARILY_HIDDEN', 'WITHDRAWN'] as const).map((state, index) => ({
      ...base,
      internalId: `00000000-0000-4000-8000-00000000000${index + 2}`,
      publicationState: state,
      reviewedProjection: { ...structuredClone(projection), slug: `fictional-${state.toLowerCase().replaceAll('_', '-')}` },
    })),
  ];
}

export interface ArchiveFixtures {
  institutions: InstitutionRecord[];
  sources: SourceRecord[];
  timeline: TimelineRecord[];
  referenceMetadata: ReferenceMetadata;
}

export function createReferenceMetadata(contract: JsonObject): ReferenceMetadata {
  const raw = resolveSchema(contract, { $ref: '#/components/examples/Metadata' }) as JsonObject;
  const { regions: _regions, ...reference } = (raw.value as { data: PublicMetadata }).data;
  return structuredClone(reference);
}

export function createArchiveFixtures(contract: JsonObject): ArchiveFixtures {
  const sourceExample = resolveSchema(contract, { $ref: '#/components/examples/SourceDetail' }) as JsonObject;
  const timelineExample = resolveSchema(contract, { $ref: '#/components/examples/TimelineList' }) as JsonObject;
  const source = structuredClone((sourceExample.value as { data: PublicSource }).data);
  const event = structuredClone((timelineExample.value as { data: PublicTimelineEvent[] }).data[0]!);
  const sourceValidator = addFormats(new Ajv2020({ strict: false })).compile(componentSchema(contract, 'PublicSource'));
  const eventValidator = addFormats(new Ajv2020({ strict: false })).compile(componentSchema(contract, 'PublicTimelineEvent'));
  if (!sourceValidator(source) || !eventValidator(event)) throw new Error('Canonical fictional archive examples are invalid');
  return {
    institutions: createFictionalRecords(contract),
    sources: [{ publicationState: 'PUBLISHED', reviewedProjection: source },
      ...(['DRAFT', 'TEMPORARILY_HIDDEN', 'WITHDRAWN'] as const).map((state) => ({
        publicationState: state, reviewedProjection: { ...structuredClone(source), id: `src-fictional-${state.toLowerCase().replaceAll('_', '-')}` },
      }))],
    timeline: [{ publicationState: 'PUBLISHED', reviewedProjection: event }],
    referenceMetadata: createReferenceMetadata(contract),
  };
}
