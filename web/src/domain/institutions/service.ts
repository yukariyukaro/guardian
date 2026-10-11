import type {
  InstitutionDossier,
  InstitutionQuery,
  InstitutionRepository,
  RelatedPageQuery,
} from './models';
import { ArchiveError } from './errors';

async function readPublic<T>(request: Promise<T>, controller: AbortController): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ArchiveError && error.kind === 'not-found') controller.abort();
    throw error;
  }
}
function requirePublic(results: readonly PromiseSettledResult<unknown>[]): void {
  if (
    results.some(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof ArchiveError &&
        result.reason.kind === 'not-found',
    )
  ) {
    throw new ArchiveError('not-found');
  }
}
async function readScope<T>(
  signal: AbortSignal | undefined,
  read: (controller: AbortController) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await read(controller);
  } finally {
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

export function createArchiveService(repository: InstitutionRepository) {
  return {
    list: (query: InstitutionQuery, signal?: AbortSignal) => repository.list(query, signal),
    get: (slug: string, signal?: AbortSignal) => repository.get(slug, signal),
    metadata: (signal?: AbortSignal) => repository.metadata(signal),
    timeline: (slug: string, query: RelatedPageQuery, signal?: AbortSignal) =>
      repository.timeline(slug, query, signal),
    sources: (slug: string, query: RelatedPageQuery, signal?: AbortSignal) =>
      repository.sources(slug, query, signal),
    source: (id: string, signal?: AbortSignal) => repository.source(id, signal),
    sourceReference: (slug: string, id: string, signal?: AbortSignal) =>
      readScope(signal, async (controller) => {
        const results = await Promise.allSettled([
          readPublic(repository.source(id, controller.signal), controller),
          readPublic(repository.get(slug, controller.signal), controller),
        ]);
        requirePublic(results);
        const [source, parent] = results;
        if (source.status === 'rejected') throw source.reason;
        if (parent.status === 'rejected') throw parent.reason;
        return source.value;
      }),
    dossier: (
      slug: string,
      timelineQuery: RelatedPageQuery,
      sourcesQuery: RelatedPageQuery,
      signal?: AbortSignal,
    ): Promise<InstitutionDossier> =>
      readScope(signal, async (controller) => {
        const results = await Promise.allSettled([
          readPublic(repository.get(slug, controller.signal), controller),
          readPublic(repository.timeline(slug, timelineQuery, controller.signal), controller),
          readPublic(repository.sources(slug, sourcesQuery, controller.signal), controller),
        ]);
        requirePublic(results);
        const [institution, timeline, sources] = results;
        if (institution.status === 'rejected') throw institution.reason;
        if (timeline.status === 'rejected') throw timeline.reason;
        if (sources.status === 'rejected') throw sources.reason;
        return { institution: institution.value, timeline: timeline.value, sources: sources.value };
      }),
  };
}
export type ArchiveService = ReturnType<typeof createArchiveService>;
