import { QueryCache, QueryClient, type QueryKey } from '@tanstack/react-query';
import { ArchiveError } from '../domain/institutions/errors';
import type { Institution } from '../domain/institutions/models';

export const unavailableKey = (slug: string) => ['archive-visibility', slug] as const;

export function isKnownUnavailable(client: QueryClient, slug: string): boolean {
  return client.getQueryData<boolean>(unavailableKey(slug)) === true;
}

export function requireVisibleRecords(client: QueryClient, records: readonly Institution[]): void {
  if (records.some((record) => isKnownUnavailable(client, record.slug))) {
    throw new ArchiveError('unavailable');
  }
}

function dossierSlug(key: QueryKey): string | undefined {
  if (key[0] !== 'archive' || key[1] !== 'institutions') return undefined;
  return (key[2] === 'dossier' || key[2] === 'source-reference') && typeof key[3] === 'string'
    ? key[3]
    : undefined;
}

export function createArchiveQueryClient(): QueryClient {
  const client = new QueryClient({
    queryCache: new QueryCache({
      onError(error, query) {
        const slug = dossierSlug(query.queryKey);
        if (!slug || !(error instanceof ArchiveError) || error.kind !== 'not-found') return;
        client.setQueryData(unavailableKey(slug), true);
        void client.cancelQueries({ queryKey: ['archive'] }, { revert: false });
        client.removeQueries({
          predicate: (entry) => dossierSlug(entry.queryKey) === slug,
        });
        void client.resetQueries({
          predicate: (entry) =>
            entry.queryKey[0] === 'archive' &&
            (entry.queryKey[1] === 'metadata' || entry.queryKey[2] === 'list'),
        });
      },
    }),
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: true,
      },
    },
  });
  client.setQueryDefaults(['archive-visibility'], { gcTime: Infinity });
  return client;
}
