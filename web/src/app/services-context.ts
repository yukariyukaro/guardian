import { createContext, useContext } from 'react';
import type { ArchiveService } from '../domain/institutions/service';

export const ArchiveServiceContext = createContext<ArchiveService | null>(null);
export function useArchiveService(): ArchiveService {
  const service = useContext(ArchiveServiceContext);
  if (!service) throw new Error('Archive service provider is required.');
  return service;
}
