import { createArchiveService } from '../domain/institutions/service';
import { createInstitutionAdapter } from '../lib/api/institution-adapter';
import { createRealPublicApi } from '../lib/api/real-public-api';
import { runtimeConfig } from './config';

export async function createServices() {
  // Vite eliminates this development-only branch, keeping fictional fixtures out of production.
  if (!import.meta.env.PROD && runtimeConfig.apiMode === 'mock') {
    const { createMockPublicApi } = await import('../mocks/public-api');
    return createArchiveService(createInstitutionAdapter(createMockPublicApi()));
  }
  return createArchiveService(
    createInstitutionAdapter(createRealPublicApi(runtimeConfig.apiBaseUrl)),
  );
}
