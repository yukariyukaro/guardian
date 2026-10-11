import {
  evidenceStatuses,
  institutionSorts,
  operatingStatuses,
  riskTags,
  type InstitutionQuery,
} from '../../../domain/institutions/models';

export const defaultInstitutionQuery: InstitutionQuery = {
  q: '',
  region: '',
  riskTag: '',
  evidenceStatus: '',
  operatingStatus: '',
  sort: 'updated_desc',
  page: 1,
  pageSize: 20,
};
function choice<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.find((entry) => entry === value) ?? fallback;
}
function positiveInteger(value: string | null, fallback: number, max: number) {
  if (!value || !/^[1-9]\d*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : fallback;
}
export function parseInstitutionQuery(params: URLSearchParams): InstitutionQuery {
  const region = params.get('region') ?? '';
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    region: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(region) && region.length <= 64 ? region : '',
    riskTag: choice(params.get('risk_tag'), ['', ...riskTags], ''),
    evidenceStatus: choice(params.get('evidence_status'), ['', ...evidenceStatuses], ''),
    operatingStatus: choice(params.get('operating_status'), ['', ...operatingStatuses], ''),
    sort: choice(params.get('sort'), institutionSorts, 'updated_desc'),
    page: positiveInteger(params.get('page'), 1, 1000000),
    pageSize: positiveInteger(params.get('page_size'), 20, 50),
  };
}
export function serializeInstitutionQuery(query: InstitutionQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.region) params.set('region', query.region);
  if (query.riskTag) params.set('risk_tag', query.riskTag);
  if (query.evidenceStatus) params.set('evidence_status', query.evidenceStatus);
  if (query.operatingStatus) params.set('operating_status', query.operatingStatus);
  if (query.sort !== 'updated_desc') params.set('sort', query.sort);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.pageSize !== 20) params.set('page_size', String(query.pageSize));
  return params;
}
export const archiveKeys = {
  list: (query: InstitutionQuery) => ['archive', 'institutions', 'list', query] as const,
  dossier: (slug: string, timelinePage: number, sourcesPage: number) =>
    ['archive', 'institutions', 'dossier', slug, timelinePage, sourcesPage] as const,
  sourceReference: (slug: string, id: string) =>
    ['archive', 'institutions', 'source-reference', slug, id] as const,
  metadata: ['archive', 'metadata'] as const,
};
