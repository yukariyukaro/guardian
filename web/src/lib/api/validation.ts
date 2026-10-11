import type {
  InstitutionDto,
  MetadataDto,
  PaginationDto,
  SourceDto,
  TimelineDto,
} from './public-api';
import { evidenceStatuses, operatingStatuses, riskTags } from '../../domain/institutions/models';
import { ArchiveError } from '../../domain/institutions/errors';

const sourceTypes = ['news', 'video', 'judgment', 'notice', 'report', 'statement'] as const;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function text(value: unknown, max = Infinity, min = 1): value is string {
  // JSON Schema lengths count Unicode code points, not UTF-16 code units.
  if (typeof value !== 'string') return false;
  const length = Array.from(value).length;
  return length >= min && length <= max;
}
function uniqueItems<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  return (
    Array.isArray(value) && Array.from(value).every(check) && new Set(value).size === value.length
  );
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function enumValue<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.some((choice) => choice === value);
}
function matches(value: string, pattern: RegExp): boolean {
  return pattern.exec(value)?.[0] === value;
}
function slug(value: unknown): value is string {
  return text(value, 120) && matches(value, slugPattern) && !uuidPattern.test(value);
}
function sourceId(value: unknown): value is string {
  return text(value, 120, 5) && matches(value, /^src-[a-z0-9]+(?:-[a-z0-9]+)*$/);
}
function eventId(value: unknown): value is string {
  return text(value, 120, 5) && matches(value, /^evt-[a-z0-9]+(?:-[a-z0-9]+)*$/);
}
function calendarDate(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const daysInMonth = days[month - 1];
  return daysInMonth !== undefined && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  const dayPart = match?.[1];
  if (!match || match[0] !== value || dayPart === undefined || !calendarDate(dayPart)) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  if (hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) return false;
  if (second !== 60) return true;
  // RFC 3339 leap-second bounds are evaluated in UTC even for offset timestamps.
  const utc = new Date(0);
  utc.setUTCFullYear(
    Number(dayPart.slice(0, 4)),
    Number(dayPart.slice(5, 7)) - 1,
    Number(dayPart.slice(8, 10)),
  );
  utc.setUTCHours(hour, minute, 59, 0);
  const offset = (offsetHour * 60 + offsetMinute) * (match[6] === '-' ? -1 : 1);
  utc.setUTCMinutes(utc.getUTCMinutes() - offset);
  return (
    utc.getUTCHours() === 23 &&
    utc.getUTCMinutes() === 59 &&
    ((utc.getUTCMonth() === 5 && utc.getUTCDate() === 30) ||
      (utc.getUTCMonth() === 11 && utc.getUTCDate() === 31))
  );
}
function date(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && calendarDate(value));
}
function region(value: unknown): value is InstitutionDto['region'] {
  return (
    object(value) &&
    onlyKeys(value, ['code', 'name', 'province', 'city']) &&
    text(value.code, 64) &&
    matches(value.code, slugPattern) &&
    text(value.name, 100) &&
    text(value.province, 100) &&
    (value.city === null || text(value.city, 100))
  );
}
function publicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host.endsWith('.')) return false;
  if (host.startsWith('[')) {
    // Public link policy does not accept IPv6 literals, including mapped IPv4.
    return false;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const octets = host.split('.').map(Number);
    const [a, b, c] = octets;
    if (a === undefined || b === undefined || c === undefined) return false;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  return (
    host.length <= 253 &&
    host.includes('.') &&
    host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|home\.arpa)$/.test(host)
  );
}
function sensitiveParameters(query: string): boolean {
  return Array.from(new URLSearchParams(query.replace(/[?;]/g, '&')).keys()).some((key) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      /(?:token|secret|password|passwd|credential|signature|passphrase|authorization|session|apikey)/.test(
        normalized,
      ) ||
      [
        'auth',
        'authorization',
        'bearer',
        'jwt',
        'session',
        'sessionid',
        'sid',
        'pwd',
        'pass',
        'sig',
        'sign',
        'signed',
        'key',
        'apikey',
        'accesskey',
        'authkey',
        'privatekey',
        'awsaccesskeyid',
        'googleaccessid',
        'code',
        'authcode',
        'oauthcode',
      ].includes(normalized) ||
      normalized.startsWith('xamz') ||
      normalized.startsWith('xgoog')
    );
  });
}
function sensitiveFragment(hash: string): boolean {
  const fragment = hash.slice(1);
  const decoded = decodeURIComponent(fragment);
  return [fragment, decoded].some(sensitiveParameters);
}
function url(value: unknown): value is string {
  if (
    !text(value, 2048) ||
    !/^https?:\/\//.test(value) ||
    !/^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/.test(value) ||
    /%(?![a-f0-9]{2})/i.test(value)
  )
    return false;
  try {
    const parsed = new URL(value);
    return (
      ['https:', 'http:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      publicHost(parsed.hostname) &&
      !sensitiveParameters(parsed.search) &&
      !sensitiveFragment(parsed.hash)
    );
  } catch {
    return false;
  }
}
export function isInstitution(value: unknown): value is InstitutionDto {
  return (
    object(value) &&
    onlyKeys(value, [
      'slug',
      'name',
      'aliases',
      'region',
      'operating_status',
      'risk_tags',
      'evidence_status',
      'public_summary',
      'source_count',
      'last_reviewed_at',
      'updated_at',
    ] satisfies readonly (keyof InstitutionDto)[]) &&
    slug(value.slug) &&
    text(value.name, 200) &&
    uniqueItems(value.aliases, (item): item is string => text(item, 200)) &&
    region(value.region) &&
    enumValue(value.operating_status, operatingStatuses) &&
    uniqueItems(value.risk_tags, (tag) => enumValue(tag, riskTags)) &&
    enumValue(value.evidence_status, evidenceStatuses) &&
    text(value.public_summary, 2000) &&
    integer(value.source_count) &&
    timestamp(value.last_reviewed_at) &&
    timestamp(value.updated_at)
  );
}
function isPagination(value: unknown): value is PaginationDto {
  return (
    object(value) &&
    onlyKeys(value, ['page', 'page_size', 'total', 'total_pages']) &&
    integer(value.page, 1, 1000000) &&
    integer(value.page_size, 1, 50) &&
    integer(value.total) &&
    integer(value.total_pages) &&
    value.total_pages === Math.ceil(value.total / value.page_size)
  );
}
export function isSource(value: unknown): value is SourceDto {
  return (
    object(value) &&
    onlyKeys(value, [
      'id',
      'title',
      'publisher',
      'source_type',
      'url',
      'published_on',
      'summary',
      'evidence_status',
      'link_status',
      'archive_url',
      'institution_slugs',
      'last_checked_at',
      'updated_at',
    ] satisfies readonly (keyof SourceDto)[]) &&
    sourceId(value.id) &&
    text(value.title, 300) &&
    text(value.publisher, 200) &&
    enumValue(value.source_type, sourceTypes) &&
    url(value.url) &&
    date(value.published_on) &&
    text(value.summary, 2000) &&
    enumValue(value.evidence_status, evidenceStatuses) &&
    enumValue(value.link_status, [
      'unchecked',
      'accessible',
      'redirected',
      'unavailable',
      'manual_review',
    ]) &&
    (value.archive_url === null || url(value.archive_url)) &&
    uniqueItems(value.institution_slugs, slug) &&
    (value.last_checked_at === null || timestamp(value.last_checked_at)) &&
    timestamp(value.updated_at)
  );
}
export function isTimeline(value: unknown): value is TimelineDto {
  return (
    object(value) &&
    onlyKeys(value, [
      'id',
      'institution_slug',
      'occurred_on',
      'occurred_until',
      'title',
      'summary',
      'evidence_status',
      'risk_tags',
      'source_ids',
      'response_status',
      'last_reviewed_at',
    ] satisfies readonly (keyof TimelineDto)[]) &&
    eventId(value.id) &&
    slug(value.institution_slug) &&
    date(value.occurred_on) &&
    date(value.occurred_until) &&
    (value.occurred_until === null ||
      (typeof value.occurred_on === 'string' && value.occurred_until >= value.occurred_on)) &&
    text(value.title, 200) &&
    text(value.summary, 2000) &&
    enumValue(value.evidence_status, evidenceStatuses) &&
    uniqueItems(value.risk_tags, (tag) => enumValue(tag, riskTags)) &&
    uniqueItems(value.source_ids, sourceId) &&
    (value.evidence_status === 'pending_verification' || value.source_ids.length > 0) &&
    enumValue(value.response_status, ['none', 'available', 'linked']) &&
    (value.response_status !== 'linked' || value.source_ids.length > 0) &&
    timestamp(value.last_reviewed_at)
  );
}
function dictionary<T extends string>(value: unknown, choices: readonly T[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === choices.length &&
    Array.from(value).every(
      (entry: unknown) =>
        object(entry) &&
        onlyKeys(entry, ['value', 'label', 'description']) &&
        enumValue(entry.value, choices) &&
        text(entry.label) &&
        text(entry.description),
    ) &&
    new Set(value.map((entry: Record<string, unknown>) => entry.value)).size === choices.length
  );
}
export function isMetadata(value: unknown): value is MetadataDto {
  return (
    object(value) &&
    onlyKeys(value, [
      'contract_version',
      'regions',
      'evidence_statuses',
      'risk_tags',
      'operating_statuses',
      'source_types',
    ] satisfies readonly (keyof MetadataDto)[]) &&
    value.contract_version === '0.1.0' &&
    Array.isArray(value.regions) &&
    Array.from(value.regions).every(region) &&
    new Set(value.regions.map((entry: InstitutionDto['region']) => entry.code)).size ===
      value.regions.length &&
    dictionary(value.evidence_statuses, evidenceStatuses) &&
    dictionary(value.risk_tags, riskTags) &&
    dictionary(value.operating_statuses, operatingStatuses) &&
    dictionary(value.source_types, sourceTypes)
  );
}
export function validateDetail<T>(
  value: unknown,
  check: (item: unknown) => item is T,
): { data: T } {
  try {
    if (object(value) && onlyKeys(value, ['data']) && check(value.data))
      return { data: value.data };
  } catch {
    // Neither validator exceptions nor response contents may reach public errors.
  }
  throw new ArchiveError('invalid-response');
}
export function validateList<T>(
  value: unknown,
  check: (item: unknown) => item is T,
): { data: T[]; pagination: PaginationDto } {
  try {
    if (
      object(value) &&
      onlyKeys(value, ['data', 'pagination']) &&
      Array.isArray(value.data) &&
      value.data.length <= 50 &&
      Array.from(value.data).every(check) &&
      isPagination(value.pagination)
    ) {
      const { page, page_size, total, total_pages } = value.pagination;
      const expected = page > total_pages ? 0 : Math.min(page_size, total - (page - 1) * page_size);
      // Lists must not repeat stable public keys, even with differing content.
      const keys = value.data.map((item: unknown) =>
        object(item) ? (item.id ?? item.slug) : undefined,
      );
      if (value.data.length === expected && new Set(keys).size === keys.length)
        return { data: value.data, pagination: value.pagination };
    }
  } catch {
    // Fail closed with a stable error, never raw input or an underlying exception.
  }
  throw new ArchiveError('invalid-response');
}
