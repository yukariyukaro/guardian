import { describe, expect, it } from 'vitest';
import { ArchiveError } from '../../domain/institutions/errors';
import { evidenceStatuses, operatingStatuses, riskTags } from '../../domain/institutions/models';
import type { InstitutionDto, MetadataDto, SourceDto, TimelineDto } from './public-api';
import {
  isInstitution,
  isMetadata,
  isSource,
  isTimeline,
  validateDetail,
  validateList,
} from './validation';

// Entirely fictional, independent fixtures: never import operational data or mocks.
const region = {
  code: 'fictional-mist-region',
  name: '虚构雾省雾港市',
  province: '虚构雾省',
  city: '虚构雾港市',
};
const institution: InstitutionDto = {
  slug: 'fictional-mist-center',
  name: '虚构示例·雾港中心',
  aliases: ['虚构雾港旧称'],
  region,
  operating_status: 'unknown',
  risk_tags: ['regulatory_action'],
  evidence_status: 'official_record',
  public_summary: '完全虚构的测试摘要，不对应真实机构或事件。',
  source_count: 1,
  last_reviewed_at: '2026-01-05T08:00:00Z',
  updated_at: '2026-01-05T08:00:00Z',
};
const source: SourceDto = {
  id: 'src-fictional-notice',
  title: '虚构示例通告',
  publisher: '虚构资料演示署',
  source_type: 'notice',
  url: 'https://example.invalid/fictional/notice',
  published_on: '2026-01-01',
  summary: '完全虚构的来源测试摘要。',
  evidence_status: 'official_record',
  link_status: 'unchecked',
  archive_url: null,
  institution_slugs: [institution.slug],
  last_checked_at: null,
  updated_at: '2026-01-05T08:00:00Z',
};
const event: TimelineDto = {
  id: 'evt-fictional-notice',
  institution_slug: institution.slug,
  occurred_on: '2026-01-01',
  occurred_until: null,
  title: '虚构示例事件',
  summary: '完全虚构的中立测试说明。',
  evidence_status: 'official_record',
  risk_tags: ['regulatory_action'],
  source_ids: [source.id],
  response_status: 'none',
  last_reviewed_at: '2026-01-05T08:00:00Z',
};
const dictionary = <T extends string>(values: readonly T[]) =>
  values.map((value) => ({ value, label: '虚构展示标签', description: '虚构展示说明' }));
const metadata: MetadataDto = {
  contract_version: '0.1.0',
  regions: [region],
  evidence_statuses: dictionary(evidenceStatuses),
  risk_tags: dictionary(riskTags),
  operating_statuses: dictionary(operatingStatuses),
  source_types: dictionary(['news', 'video', 'judgment', 'notice', 'report', 'statement'] as const),
};
const schemas = [
  { name: 'institution', value: institution, check: isInstitution },
  { name: 'source', value: source, check: isSource },
  { name: 'timeline', value: event, check: isTimeline },
  { name: 'metadata', value: metadata, check: isMetadata },
];
function expectSafeFailure(action: () => unknown) {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ArchiveError);
  expect(caught).toMatchObject({ kind: 'invalid-response', message: 'invalid-response' });
  expect((caught as ArchiveError).requestId).toBeUndefined();
  expect(caught).not.toHaveProperty('cause');
  expect(JSON.stringify(caught)).not.toContain('fictional-private-probe');
}
function list(data: unknown[], page = 1, pageSize = 20, total = data.length) {
  return {
    data,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  };
}

describe('strict public response validation (OpenAPI 0.1.0)', () => {
  for (const { name, value, check } of schemas) {
    describe(name, () => {
      it('accepts the independent fictional DTO without changing data', () => {
        const payload = structuredClone(value);
        expect(check(payload)).toBe(true);
        const result = validateDetail({ data: payload }, (item): item is unknown => check(item));
        expect(result.data).toBe(payload);
        expect(payload).toEqual(value);
      });
      it.each(Object.keys(value))('rejects missing required field %s', (key) => {
        const payload: Record<string, unknown> = { ...value };
        delete payload[key];
        expect(check(payload)).toBe(false);
      });
      it('rejects additional private fields and unsafe envelopes', () => {
        expect(check({ ...value, reviewer_note: 'fictional-private-probe' })).toBe(false);
        for (const payload of [null, [], {}, { data: value, extra: 'fictional-private-probe' }]) {
          expectSafeFailure(() => validateDetail(payload, (item): item is unknown => check(item)));
        }
      });
    });
  }

  const bounded = [
    { name: 'institution name', value: institution, check: isInstitution, field: 'name', max: 200 },
    {
      name: 'institution summary',
      value: institution,
      check: isInstitution,
      field: 'public_summary',
      max: 2000,
    },
    { name: 'source title', value: source, check: isSource, field: 'title', max: 300 },
    { name: 'source publisher', value: source, check: isSource, field: 'publisher', max: 200 },
    { name: 'source summary', value: source, check: isSource, field: 'summary', max: 2000 },
    { name: 'event title', value: event, check: isTimeline, field: 'title', max: 200 },
    { name: 'event summary', value: event, check: isTimeline, field: 'summary', max: 2000 },
  ];
  it.each(bounded)('enforces code-point lengths for $name', ({ value, check, field, max }) => {
    for (const invalid of ['', null, 1, '虚'.repeat(max + 1), '😀'.repeat(max + 1)])
      expect(check({ ...value, [field]: invalid })).toBe(false);
    for (const valid of ['虚', '虚'.repeat(max), '😀'.repeat(max)])
      expect(check({ ...value, [field]: valid })).toBe(true);
  });
  it('enforces alias item lengths and uniqueness without imposing array bounds', () => {
    for (const aliases of [[''], [1], ['虚'.repeat(201)], ['重复', '重复']])
      expect(isInstitution({ ...institution, aliases })).toBe(false);
    expect(isInstitution({ ...institution, aliases: [] })).toBe(true);
    expect(isInstitution({ ...institution, aliases: ['😀'.repeat(200)] })).toBe(true);
    expect(
      isInstitution({
        ...institution,
        aliases: Array.from({ length: 60 }, (_, i) => `虚构别名${i}`),
      }),
    ).toBe(true);
  });
  it.each(['code', 'name', 'province', 'city'] as const)(
    'enforces region field %s and whitelist',
    (field) => {
      const max = field === 'code' ? 64 : 100;
      for (const invalid of ['', 'a'.repeat(max + 1), 1, undefined])
        expect(isInstitution({ ...institution, region: { ...region, [field]: invalid } })).toBe(
          false,
        );
      expect(
        isInstitution({ ...institution, region: { ...region, [field]: 'a'.repeat(max) } }),
      ).toBe(true);
      const missing: Record<string, unknown> = { ...region };
      delete missing[field];
      expect(isInstitution({ ...institution, region: missing })).toBe(false);
    },
  );
  it('validates nullable city and region code pattern', () => {
    expect(isInstitution({ ...institution, region: { ...region, city: null } })).toBe(true);
    for (const code of ['Upper', 'a--b', '-a', 'a-', 'a_b', 'a\n'])
      expect(isInstitution({ ...institution, region: { ...region, code } })).toBe(false);
    expect(isInstitution({ ...institution, region: { ...region, latitude: 0 } })).toBe(false);
  });

  const publicKeys = [
    {
      name: 'institution slug',
      value: institution,
      check: isInstitution,
      field: 'slug',
      prefix: '',
      min: 1,
    },
    { name: 'source key', value: source, check: isSource, field: 'id', prefix: 'src-', min: 5 },
    { name: 'event key', value: event, check: isTimeline, field: 'id', prefix: 'evt-', min: 5 },
    {
      name: 'event institution reference',
      value: event,
      check: isTimeline,
      field: 'institution_slug',
      prefix: '',
      min: 1,
    },
  ];
  it.each(publicKeys)(
    'enforces $name length and pattern',
    ({ value, check, field, prefix, min }) => {
      expect(check({ ...value, [field]: `${prefix}a` })).toBe(true);
      expect(check({ ...value, [field]: prefix + 'a'.repeat(120 - prefix.length) })).toBe(true);
      for (const invalid of [
        '',
        prefix,
        prefix + 'a'.repeat(121 - prefix.length),
        `${prefix}A`,
        `${prefix}a_b`,
        `${prefix}a--b`,
        `${prefix}a\n`,
        'a'.repeat(min - 1),
      ])
        expect(check({ ...value, [field]: invalid })).toBe(false);
    },
  );
  it('rejects internal UUIDs for institution keys and all institution references', () => {
    const internal = '00000000-0000-4000-8000-000000000000';
    expect(isInstitution({ ...institution, slug: internal })).toBe(false);
    expect(isTimeline({ ...event, institution_slug: internal })).toBe(false);
    expect(isSource({ ...source, institution_slugs: [internal] })).toBe(false);
  });
  it('validates every source/slug reference, including uniqueItems', () => {
    for (const source_ids of [
      ['wrong-key'],
      ['src-'],
      ['src-a\n'],
      ['src-' + 'a'.repeat(117)],
      [source.id, source.id],
    ])
      expect(isTimeline({ ...event, source_ids })).toBe(false);
    for (const institution_slugs of [
      ['Wrong'],
      ['a--b'],
      ['a'.repeat(121)],
      [institution.slug, institution.slug],
    ])
      expect(isSource({ ...source, institution_slugs })).toBe(false);
    expect(isSource({ ...source, institution_slugs: [] })).toBe(true);
    expect(isTimeline({ ...event, source_ids: ['src-a'] })).toBe(true);
    expect(isSource({ ...source, institution_slugs: ['a'] })).toBe(true);
  });
  it('rejects duplicate/unknown risk tags in institutions and events', () => {
    for (const risk_tags of [
      ['regulatory_action', 'regulatory_action'],
      ['unknown'],
      [null],
      'regulatory_action',
    ]) {
      expect(isInstitution({ ...institution, risk_tags })).toBe(false);
      expect(isTimeline({ ...event, risk_tags })).toBe(false);
    }
    expect(isInstitution({ ...institution, risk_tags: [...riskTags] })).toBe(true);
    expect(isTimeline({ ...event, risk_tags: [] })).toBe(true);
  });
  it('accepts every contract enum and rejects unknown/non-string values', () => {
    const cases = [
      {
        value: institution,
        check: isInstitution,
        field: 'operating_status',
        choices: operatingStatuses,
      },
      {
        value: institution,
        check: isInstitution,
        field: 'evidence_status',
        choices: evidenceStatuses,
      },
      { value: source, check: isSource, field: 'evidence_status', choices: evidenceStatuses },
      { value: event, check: isTimeline, field: 'evidence_status', choices: evidenceStatuses },
      {
        value: source,
        check: isSource,
        field: 'source_type',
        choices: metadata.source_types.map((entry) => entry.value),
      },
      {
        value: source,
        check: isSource,
        field: 'link_status',
        choices: ['unchecked', 'accessible', 'redirected', 'unavailable', 'manual_review'],
      },
      {
        value: event,
        check: isTimeline,
        field: 'response_status',
        choices: ['none', 'available', 'linked'],
      },
    ];
    for (const { value, check, field, choices } of cases) {
      for (const valid of choices) expect(check({ ...value, [field]: valid })).toBe(true);
      for (const invalid of ['unknown-private-state', '', null, 1])
        expect(check({ ...value, [field]: invalid })).toBe(false);
    }
  });
  it('enforces public source counts without coercion', () => {
    for (const source_count of [-1, 0.5, '1', null, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(isInstitution({ ...institution, source_count })).toBe(false);
    expect(isInstitution({ ...institution, source_count: 0 })).toBe(true);
  });

  const invalidDates = [
    '2026-02-29',
    '1900-02-29',
    '2024-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '2026-01-32',
    '26-01-01',
    '2026-1-01',
    '2026-01-01T00:00:00Z',
    '2026-01-01\n',
    '',
  ];
  it.each(invalidDates)(
    'rejects invalid calendar date %s in all nullable date fields',
    (invalid) => {
      expect(isSource({ ...source, published_on: invalid })).toBe(false);
      expect(isTimeline({ ...event, occurred_on: invalid })).toBe(false);
      expect(isTimeline({ ...event, occurred_until: invalid })).toBe(false);
    },
  );
  it.each(['2000-02-29', '2024-02-29', '2026-04-30', '0000-02-29'])(
    'accepts valid Gregorian date %s',
    (valid) => {
      expect(isSource({ ...source, published_on: valid })).toBe(true);
      expect(isTimeline({ ...event, occurred_on: valid, occurred_until: valid })).toBe(true);
    },
  );
  const timestampFields = [
    {
      name: 'institution reviewed',
      value: institution,
      check: isInstitution,
      field: 'last_reviewed_at',
    },
    { name: 'institution updated', value: institution, check: isInstitution, field: 'updated_at' },
    { name: 'source checked', value: source, check: isSource, field: 'last_checked_at' },
    { name: 'source updated', value: source, check: isSource, field: 'updated_at' },
    { name: 'event reviewed', value: event, check: isTimeline, field: 'last_reviewed_at' },
  ];
  it.each(timestampFields)('requires strict RFC3339 for $name', ({ value, check, field }) => {
    for (const invalid of [
      '2026-02-29T00:00:00Z',
      '2026-04-31T00:00:00Z',
      '2026-01-01',
      '2026-01-01T00:00:00',
      '2026-01-01 00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:61Z',
      '2026-01-01T00:00:00+24:00',
      '2026-01-01T00:00:00+00:60',
      '2026-01-01T00:00:00+0800',
      '2026-01-01T00:00:00.Z',
      '2026-01-01T00:00:00Z\n',
      '2026-01-01T12:00:60Z',
      '',
    ])
      expect(check({ ...value, [field]: invalid })).toBe(false);
    for (const valid of [
      '2024-02-29T23:59:59Z',
      '2000-02-29t08:00:00z',
      '2026-01-01T00:00:00.123456789+08:00',
      '2026-01-01T00:00:00-00:00',
      '2016-12-31T23:59:60Z',
      '2017-01-01T07:59:60+08:00',
      '2015-06-30T23:59:60Z',
    ])
      expect(check({ ...value, [field]: valid })).toBe(true);
  });
  it('accepts nullable dates/timestamps but requires event intervals and source support', () => {
    expect(isSource({ ...source, published_on: null, last_checked_at: null })).toBe(true);
    expect(isTimeline({ ...event, occurred_on: null, occurred_until: null })).toBe(true);
    expect(isTimeline({ ...event, occurred_on: null, occurred_until: '2026-01-02' })).toBe(false);
    expect(isTimeline({ ...event, occurred_until: '2025-12-31' })).toBe(false);
    expect(isTimeline({ ...event, occurred_until: '2026-01-02' })).toBe(true);
    expect(isTimeline({ ...event, source_ids: [] })).toBe(false);
    expect(isTimeline({ ...event, evidence_status: 'pending_verification', source_ids: [] })).toBe(
      true,
    );
    expect(
      isTimeline({
        ...event,
        evidence_status: 'pending_verification',
        source_ids: [],
        response_status: 'linked',
      }),
    ).toBe(false);
  });

  describe('public source and archive URL safety (no DNS/network)', () => {
    const unsafe = [
      { name: 'unsupported protocol', url: 'ftp://example.invalid/fictional' },
      { name: 'protocol case violates contract pattern', url: 'HTTPS://example.invalid/fictional' },
      { name: 'relative URL', url: '/fictional' },
      { name: 'protocol relative URL', url: '//example.invalid/fictional' },
      { name: 'credentials', url: 'https://fictional-user:fictional-password@example.invalid/' },
      { name: 'username only', url: 'https://fictional-user@example.invalid/' },
      { name: 'trailing-dot target', url: 'https://example.invalid./fictional' },
      { name: 'leading whitespace', url: ' https://example.invalid/' },
      { name: 'trailing whitespace', url: 'https://example.invalid/ ' },
      { name: 'control character', url: 'https://example.invalid/\nfictional' },
      { name: 'backslash normalization', url: 'https://example.invalid\\fictional' },
      { name: 'invalid escape', url: 'https://example.invalid/%zz' },
      { name: 'unencoded Unicode URI', url: 'https://example.invalid/虚构' },
      { name: 'overlong URI', url: 'https://example.invalid/' + 'a'.repeat(2048) },
      { name: 'localhost', url: 'http://localhost/fictional' },
      { name: 'localhost subdomain', url: 'http://fictional.localhost./' },
      { name: 'single-label target', url: 'http://fictional/' },
      { name: 'local suffix', url: 'http://fictional.local/' },
      { name: 'internal suffix', url: 'http://fictional.internal/' },
      { name: 'intranet suffix', url: 'http://fictional.intranet/' },
      { name: 'LAN suffix', url: 'http://fictional.lan/' },
      { name: 'home suffix', url: 'http://fictional.home/' },
      { name: 'home arpa', url: 'http://fictional.home.arpa/' },
      { name: 'IPv4 loopback', url: 'http://127.0.0.1/' },
      { name: 'IPv4 decimal loopback', url: 'http://2130706433/' },
      { name: 'IPv4 hex loopback', url: 'http://0x7f000001/' },
      { name: 'IPv4 short loopback', url: 'http://127.1/' },
      { name: 'unspecified IPv4', url: 'http://0.0.0.0/' },
      { name: 'private class A', url: 'http://10.0.0.1/' },
      { name: 'private class B', url: 'http://172.16.0.1/' },
      { name: 'private class C', url: 'http://192.168.0.1/' },
      { name: 'link-local target', url: 'http://169.254.169.254/' },
      { name: 'shared address space', url: 'http://100.64.0.1/' },
      { name: 'benchmark address', url: 'http://198.18.0.1/' },
      { name: 'documentation IPv4', url: 'http://192.0.2.1/' },
      { name: 'documentation IPv4 second range', url: 'http://198.51.100.1/' },
      { name: 'documentation IPv4 third range', url: 'http://203.0.113.1/' },
      { name: 'multicast IPv4', url: 'http://224.0.0.1/' },
      { name: 'reserved IPv4', url: 'http://240.0.0.1/' },
      { name: 'IPv6 loopback', url: 'http://[::1]/' },
      { name: 'IPv6 unspecified', url: 'http://[::]/' },
      { name: 'IPv6 unique local', url: 'http://[fd00::1]/' },
      { name: 'IPv6 link local', url: 'http://[fe80::1]/' },
      { name: 'IPv6 multicast', url: 'http://[ff02::1]/' },
      { name: 'IPv4 mapped IPv6', url: 'http://[::ffff:127.0.0.1]/' },
      { name: 'IPv6 transition range', url: 'http://[2002:7f00:1::]/' },
      { name: 'IPv6 documentation range', url: 'http://[2001:db8::1]/' },
      { name: 'IPv6 Teredo range', url: 'http://[2001:0:7f00:1::]/' },
      {
        name: 'access token parameter',
        url: 'https://example.invalid/?access_token=fictional-private-probe',
      },
      {
        name: 'encoded token parameter',
        url: 'https://example.invalid/?%74oken=fictional-private-probe',
      },
      {
        name: 'mixed case password parameter',
        url: 'https://example.invalid/?PassWord=fictional-private-probe',
      },
      {
        name: 'API key parameter',
        url: 'https://example.invalid/?api_key=fictional-private-probe',
      },
      {
        name: 'signed storage parameter',
        url: 'https://example.invalid/?X-Amz-Signature=fictional-private-probe',
      },
      {
        name: 'signed Google storage parameter',
        url: 'https://example.invalid/?X-Goog-Credential=fictional-private-probe',
      },
      { name: 'signature parameter', url: 'https://example.invalid/?sig=fictional-private-probe' },
      {
        name: 'fragment token',
        url: 'https://example.invalid/#access_token=fictional-private-probe',
      },
    ];
    it.each([
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
      'passphrase',
      'x-amz-date',
      'x-goog-date',
      'a!c!c!e!s!s!_!t!o!k!e!n',
    ])(
      'rejects credential parameter %s in queries, fragment routes and encoded fragments',
      (key) => {
        const params = new URLSearchParams({ [key]: 'fictional-private-probe' }).toString();
        for (const suffix of [
          `?${params}`,
          `#${params}`,
          `#/reader?${params}`,
          `#${encodeURIComponent(params)}`,
        ]) {
          for (const field of ['url', 'archive_url'])
            expect(isSource({ ...source, [field]: `https://example.invalid/${suffix}` })).toBe(
              false,
            );
        }
      },
    );
    it.each([
      { name: 'semicolon credential separator', suffix: '?page=2;token=fictional-private-probe' },
      {
        name: 'question-mark credential separator',
        suffix: '?page=2?token=fictional-private-probe',
      },
      { name: 'fragment route semicolon', suffix: '#/reader?page=2;token=fictional-private-probe' },
      { name: 'encoded fragment semicolon', suffix: '#page%3D2%3Btoken%3Dfictional-private-probe' },
      {
        name: 'authorization substring',
        suffix: '?public_authorization_value=fictional-private-probe',
      },
      { name: 'session substring', suffix: '?public_session_value=fictional-private-probe' },
      { name: 'API key substring', suffix: '?public_apikey_value=fictional-private-probe' },
    ])('rejects $name consistently with the server link policy', ({ suffix }) => {
      for (const field of ['url', 'archive_url'])
        expect(isSource({ ...source, [field]: `https://example.invalid/${suffix}` })).toBe(false);
    });
    it.each(unsafe)('rejects $name in url and archive_url with a safe error', ({ url }) => {
      for (const field of ['url', 'archive_url']) {
        expect(isSource({ ...source, [field]: url })).toBe(false);
        expectSafeFailure(() => validateDetail({ data: { ...source, [field]: url } }, isSource));
      }
    });
    it.each([
      'http://example.invalid/fictional',
      'https://example.invalid:8443/fictional',
      'https://example.invalid/%E8%99%9A%E6%9E%84?page=2#reference',
      'https://example.invalid/?page=2&lang=zh&view=reader&q=fictional&sort=date#section-2',
      'https://example.invalid/#/reader?page=2&lang=zh&view=reader&q=fictional&sort=date',
      'https://example.invalid/' + 'a'.repeat(2048 - 'https://example.invalid/'.length),
    ])('accepts reviewed-style HTTP(S) fixture link %s', (url) => {
      expect(isSource({ ...source, url, archive_url: url })).toBe(true);
    });
  });

  describe('metadata completeness and uniqueness', () => {
    it('rejects repeated region codes even when names differ', () => {
      expect(
        isMetadata({ ...metadata, regions: [region, { ...region, name: '另一虚构名称' }] }),
      ).toBe(false);
      expect(isMetadata({ ...metadata, regions: [] })).toBe(true);
      expect(
        isMetadata({
          ...metadata,
          regions: [region, { ...region, code: 'fictional-other-region' }],
        }),
      ).toBe(true);
    });
    it.each(['evidence_statuses', 'risk_tags', 'operating_statuses', 'source_types'] as const)(
      'requires a complete unique %s dictionary and nested whitelist',
      (field) => {
        const entries = metadata[field];
        for (const invalid of [
          [],
          entries.slice(1),
          [...entries, entries[0]],
          [entries[0], ...entries.slice(0, -1)],
          [{ ...entries[0], value: 'unknown' }, ...entries.slice(1)],
          [{ ...entries[0], label: '' }, ...entries.slice(1)],
          [{ ...entries[0], description: '' }, ...entries.slice(1)],
          [{ ...entries[0], private_note: 'fictional-private-probe' }, ...entries.slice(1)],
        ])
          expect(isMetadata({ ...metadata, [field]: invalid })).toBe(false);
        expect(isMetadata({ ...metadata, [field]: [...entries].reverse() })).toBe(true);
        expect(
          isMetadata({
            ...metadata,
            [field]: entries.map((entry) => ({
              ...entry,
              label: '虚'.repeat(500),
              description: '虚'.repeat(500),
            })),
          }),
        ).toBe(true);
      },
    );
    it('rejects contract version drift and malformed regions', () => {
      expect(isMetadata({ ...metadata, contract_version: '0.2.0' })).toBe(false);
      expect(
        isMetadata({
          ...metadata,
          regions: [{ ...region, private_note: 'fictional-private-probe' }],
        }),
      ).toBe(false);
      expect(isMetadata({ ...metadata, regions: [{ ...region, code: 'Bad' }] })).toBe(false);
    });
  });

  describe('list pagination semantic counts', () => {
    for (const { name, value, check } of schemas.filter((schema) => schema.name !== 'metadata')) {
      it(`${name}: accepts exact first/last page, empty and out-of-range pages`, () => {
        const guard = (item: unknown): item is unknown => check(item);
        expect(validateList(list([value], 1, 1, 2), guard).data).toEqual([value]);
        expect(validateList(list([value], 2, 20, 21), guard).data).toEqual([value]);
        expect(validateList(list([], 1, 20, 0), guard).data).toEqual([]);
        expect(validateList(list([], 3, 20, 21), guard).pagination.page).toBe(3);
        expect(validateList(list([], 1000000, 50, 1), guard).pagination.page).toBe(1000000);
      });
      it(`${name}: rejects missing/excess results and duplicate stable keys`, () => {
        const guard = (item: unknown): item is unknown => check(item);
        for (const payload of [
          list([], 1, 20, 1),
          list([value], 1, 20, 0),
          list([value], 2, 20, 1),
          list([value], 1, 20, 21),
          list([value, { ...value, name: '不同虚构内容' }], 1, 20, 2),
          list([value], 2, 20, 22),
        ])
          expectSafeFailure(() => validateList(payload, guard));
      });
    }
    it('rejects duplicate stable keys despite differing otherwise-valid content', () => {
      expectSafeFailure(() =>
        validateList(list([source, { ...source, title: '另一虚构标题' }]), isSource),
      );
      expectSafeFailure(() =>
        validateList(list([event, { ...event, title: '另一虚构事件' }]), isTimeline),
      );
    });
    it('accepts a full 50-item page and rejects maxItems overflow', () => {
      const data = Array.from({ length: 50 }, (_, i) => ({
        ...institution,
        slug: `fictional-center-${i}`,
      }));
      expect(validateList(list(data, 1, 50), isInstitution).data).toHaveLength(50);
      expectSafeFailure(() =>
        validateList(
          list([...data, { ...institution, slug: 'fictional-extra' }], 1, 50),
          isInstitution,
        ),
      );
    });
    const invalidPagination = [
      { field: 'page', values: [0, -1, 1000001, 1.5, '1', null] },
      { field: 'page_size', values: [0, -1, 51, 1.5, '20', null] },
      { field: 'total', values: [-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1, Infinity] },
      { field: 'total_pages', values: [-1, 0, 2, 1.5, '1', null, Infinity] },
    ];
    it.each(invalidPagination)(
      'enforces pagination $field type and bounds',
      ({ field, values }) => {
        const payload = list([institution]);
        for (const invalid of values)
          expectSafeFailure(() =>
            validateList(
              { ...payload, pagination: { ...payload.pagination, [field]: invalid } },
              isInstitution,
            ),
          );
        const missing: Record<string, unknown> = { ...payload.pagination };
        delete missing[field];
        expectSafeFailure(() => validateList({ ...payload, pagination: missing }, isInstitution));
      },
    );
    it('rejects nested/envelope extras and unsafe array shapes', () => {
      const payload = list([institution]);
      for (const invalid of [
        null,
        [],
        {},
        { ...payload, extra: 'fictional-private-probe' },
        { ...payload, pagination: { ...payload.pagination, extra: 'fictional-private-probe' } },
        { ...payload, data: [null] },
        { ...payload, data: new Array(1) },
        { ...payload, data: 'not-an-array' },
      ])
        expectSafeFailure(() => validateList(invalid, isInstitution));
    });
    it('returns only a safe ArchiveError when a guard throws', () => {
      const throwing = (item: unknown): item is InstitutionDto => {
        if (item) throw new Error('fictional-private-probe');
        return false;
      };
      expectSafeFailure(() => validateDetail({ data: institution }, throwing));
      expectSafeFailure(() => validateList(list([institution]), throwing));
    });
  });
});
