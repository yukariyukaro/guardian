import { describe, expect, it } from 'vitest';
import {
  archiveKeys,
  defaultInstitutionQuery,
  parseInstitutionQuery,
  serializeInstitutionQuery,
} from './query-state';

describe('URL query state', () => {
  it('uses safe defaults for invalid input and trims keywords', () => {
    const parsed = parseInstitutionQuery(
      new URLSearchParams(
        'page=-1&page_size=500&sort=score&evidence_status=secret&q=%20雾港%20&region=bad/code',
      ),
    );
    expect(parsed).toEqual({ ...defaultInstitutionQuery, q: '雾港' });
    expect(serializeInstitutionQuery(parsed).toString()).toBe('q=%E9%9B%BE%E6%B8%AF');
  });
  it('roundtrips all supported public filters', () => {
    const query = {
      ...defaultInstitutionQuery,
      q: '雾港',
      region: 'fictional-mist-region',
      riskTag: 'regulatory_action' as const,
      evidenceStatus: 'official_record' as const,
      operatingStatus: 'unknown' as const,
      sort: 'name_asc' as const,
      page: 2,
      pageSize: 3,
    };
    expect(parseInstitutionQuery(serializeInstitutionQuery(query))).toEqual(query);
    expect(archiveKeys.list(query)[0]).toBe('archive');
  });
});
