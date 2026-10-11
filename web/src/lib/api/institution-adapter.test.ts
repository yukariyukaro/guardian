import { describe, expect, it } from 'vitest';
import { createInstitutionAdapter } from './institution-adapter';
import { createMockPublicApi } from '../../mocks/public-api';
import { defaultInstitutionQuery } from '../../features/archive/institutions/query-state';
import { ArchiveError } from '../../domain/institutions/errors';
import {
  mockInstitutions,
  mockMetadata,
  mockSources,
  mockTimeline,
} from '../../mocks/fixtures/institutions';
import { isInstitution, isMetadata, isSource, isTimeline, validateList } from './validation';

const repository = createInstitutionAdapter(createMockPublicApi({ delayMs: 0 }));
describe('public institution adapter', () => {
  it('matches aliases, combines filters and maps only public domain fields', async () => {
    const result = await repository.list({
      ...defaultInstitutionQuery,
      q: '雾港旧称',
      region: 'fictional-mist-region',
      evidenceStatus: 'official_record',
    });
    expect(result.total).toBe(1);
    expect(result.records[0]).toMatchObject({
      slug: 'fictional-mist-harbor-center',
      sourceCount: 1,
    });
    expect(result.records[0]).not.toHaveProperty('public_summary');
    expect(result.records[0]).not.toHaveProperty('id');
  });
  it('paginates with actual totals and preserves out-of-range page', async () => {
    expect(
      await repository.list({ ...defaultInstitutionQuery, pageSize: 3, page: 2 }),
    ).toMatchObject({ total: 5, totalPages: 2, page: 2 });
    expect(
      await repository.list({ ...defaultInstitutionQuery, pageSize: 3, page: 9 }),
    ).toMatchObject({ records: [], total: 5, page: 9 });
    expect(
      await repository.list({ ...defaultInstitutionQuery, q: '不存在的演示机构' }),
    ).toMatchObject({ records: [], totalPages: 0 });
  });
  it('returns identical safe not-found behavior for nonpublic records', async () => {
    for (const slug of ['fictional-hidden', 'fictional-withdrawn', 'fictional-draft', 'missing']) {
      await expect(repository.get(slug)).rejects.toMatchObject({ kind: 'not-found' });
    }
  });
  it('supports cancellation and error scenarios', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      repository.get('fictional-mist-harbor-center', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(createMockPublicApi({ delayMs: 0, fail: true }).metadata()).rejects.toBeInstanceOf(
      ArchiveError,
    );
  });
  it('rejects mismatched detail identity and related parent associations', async () => {
    const base = createMockPublicApi({ delayMs: 0 });
    const wrongDetail = createInstitutionAdapter({
      ...base,
      get: async () => ({ data: mockInstitutions[1]! }),
    });
    await expect(wrongDetail.get(mockInstitutions[0]!.slug)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
    const wrongSource = createInstitutionAdapter({
      ...base,
      sources: async () => ({
        data: [{ ...mockSources[0]!, institution_slugs: ['fictional-other'] }],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      }),
    });
    await expect(
      wrongSource.sources(mockInstitutions[0]!.slug, { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
    const wrongTimeline = createInstitutionAdapter({
      ...base,
      timeline: async () => ({
        data: [{ ...mockTimeline[0]!, institution_slug: 'fictional-other' }],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      }),
    });
    await expect(
      wrongTimeline.timeline(mockInstitutions[0]!.slug, { page: 1, pageSize: 20 }),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
    const wrongPage = createInstitutionAdapter({
      ...base,
      timeline: async () => ({
        data: [],
        pagination: { page: 1, page_size: 20, total: 0, total_pages: 0 },
      }),
    });
    await expect(
      wrongPage.timeline(mockInstitutions[0]!.slug, { page: 2, pageSize: 20 }),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('validates every generated fixture and fails closed on malformed data', () => {
    expect(mockInstitutions.every(isInstitution)).toBe(true);
    expect(mockSources.every(isSource)).toBe(true);
    expect(mockTimeline.every(isTimeline)).toBe(true);
    expect(isMetadata(mockMetadata)).toBe(true);
    expect(() =>
      validateList(
        {
          data: mockInstitutions,
          pagination: { page: 1, page_size: 20, total: 5, total_pages: 99 },
        },
        isInstitution,
      ),
    ).toThrow(ArchiveError);
  });
});
