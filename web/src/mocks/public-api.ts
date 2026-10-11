import type { PublicApi } from '../lib/api/public-api';
import { ArchiveError } from '../domain/institutions/errors';
import { mockInstitutions, mockMetadata, mockSources, mockTimeline } from './fixtures/institutions';

export function createMockPublicApi({
  delayMs = 180,
  fail = false,
}: { delayMs?: number; fail?: boolean } = {}): PublicApi {
  async function wait(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, delayMs);
      signal?.addEventListener('abort', abort, { once: true });
    });
    if (fail) throw new ArchiveError('network');
  }
  function requirePublic(slug: string) {
    const record = mockInstitutions.find((item) => item.slug === slug);
    // Unknown, hidden, withdrawn and draft all use the identical public 404.
    if (!record) throw new ArchiveError('not-found');
    return record;
  }
  function paginate<T>(data: T[], page = 1, pageSize = 20) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 50
    )
      throw new ArchiveError('validation');
    return {
      data: data.slice((page - 1) * pageSize, page * pageSize),
      pagination: {
        page,
        page_size: pageSize,
        total: data.length,
        total_pages: Math.ceil(data.length / pageSize),
      },
    };
  }
  return {
    async list(params, signal) {
      await wait(signal);
      if (params.region && !mockMetadata.regions.some((region) => region.code === params.region))
        throw new ArchiveError('validation');
      const q = params.q?.trim().toLocaleLowerCase() ?? '';
      if (q.length > 100) throw new ArchiveError('validation');
      const records = mockInstitutions
        .filter(
          (record) =>
            (!q ||
              [record.name, ...record.aliases].some((name) =>
                name.toLocaleLowerCase().includes(q),
              )) &&
            (!params.region || record.region.code === params.region) &&
            (!params.risk_tag || record.risk_tags.includes(params.risk_tag)) &&
            (!params.evidence_status || record.evidence_status === params.evidence_status) &&
            (!params.operating_status || record.operating_status === params.operating_status),
        )
        .sort((a, b) => {
          const primary =
            params.sort === 'name_asc'
              ? a.name.localeCompare(b.name, 'zh-CN')
              : params.sort === 'updated_asc'
                ? Date.parse(a.updated_at) - Date.parse(b.updated_at)
                : Date.parse(b.updated_at) - Date.parse(a.updated_at);
          return primary || a.slug.localeCompare(b.slug);
        });
      return structuredClone(paginate(records, params.page, params.page_size));
    },
    async get(slug, signal) {
      await wait(signal);
      return { data: structuredClone(requirePublic(slug)) };
    },
    async metadata(signal) {
      await wait(signal);
      return { data: structuredClone(mockMetadata) };
    },
    async timeline(slug, params, signal) {
      await wait(signal);
      requirePublic(slug);
      return structuredClone(
        paginate(
          mockTimeline
            .filter((event) => event.institution_slug === slug)
            .sort((a, b) => {
              const primary =
                a.occurred_on === null
                  ? b.occurred_on === null
                    ? 0
                    : 1
                  : b.occurred_on === null
                    ? -1
                    : a.occurred_on.localeCompare(b.occurred_on) *
                      (params.sort === 'date_asc' ? 1 : -1);
              return primary || a.id.localeCompare(b.id);
            }),
          params.page,
          params.page_size,
        ),
      );
    },
    async sources(slug, params, signal) {
      await wait(signal);
      requirePublic(slug);
      const q = params.q?.trim().toLocaleLowerCase() ?? '';
      const records = mockSources
        .filter(
          (source) =>
            source.institution_slugs.includes(slug) &&
            (!q ||
              [source.title, source.publisher].some((text) =>
                text.toLocaleLowerCase().includes(q),
              )) &&
            (!params.source_type || source.source_type === params.source_type) &&
            (!params.evidence_status || source.evidence_status === params.evidence_status),
        )
        .sort((a, b) => {
          const primary =
            params.sort === 'updated_desc'
              ? Date.parse(b.updated_at) - Date.parse(a.updated_at)
              : a.published_on === null
                ? b.published_on === null
                  ? 0
                  : 1
                : b.published_on === null
                  ? -1
                  : a.published_on.localeCompare(b.published_on) *
                    (params.sort === 'published_asc' ? 1 : -1);
          return primary || a.id.localeCompare(b.id);
        });
      return structuredClone(paginate(records, params.page, params.page_size));
    },
    async source(id, signal) {
      await wait(signal);
      const source = mockSources.find((item) => item.id === id);
      if (!source) throw new ArchiveError('not-found');
      return { data: structuredClone(source) };
    },
  };
}
