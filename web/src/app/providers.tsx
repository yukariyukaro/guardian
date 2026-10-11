import { QueryClientProvider } from '@tanstack/react-query';
import { createArchiveQueryClient } from './archive-query-client';
import { useState, type ReactNode } from 'react';
import type { ArchiveService } from '../domain/institutions/service';
import { ArchiveServiceContext } from './services-context';

export function AppProviders({
  service,
  children,
}: {
  service: ArchiveService;
  children: ReactNode;
}) {
  const [queryClient] = useState(createArchiveQueryClient);
  return (
    <ArchiveServiceContext.Provider value={service}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ArchiveServiceContext.Provider>
  );
}
