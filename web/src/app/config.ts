export interface RuntimeConfig {
  apiMode: 'mock' | 'real';
  apiBaseUrl: string;
}

export function readRuntimeConfig(env: {
  mode?: string;
  baseUrl?: string;
  production: boolean;
}): RuntimeConfig {
  const apiMode = env.mode ?? (env.production ? 'real' : 'mock');
  if (apiMode !== 'mock' && apiMode !== 'real') {
    throw new Error('VITE_API_MODE must be mock or real.');
  }
  if (env.production && apiMode === 'mock') {
    throw new Error('Mock APIs are disabled in production.');
  }
  const apiBaseUrl = (env.baseUrl ?? '').replace(/\/$/, '');
  if (
    apiBaseUrl !== '' &&
    (!apiBaseUrl.startsWith('/') || apiBaseUrl.startsWith('//') || /[?#\\]/.test(apiBaseUrl))
  ) {
    throw new Error('VITE_PUBLIC_API_BASE_URL must be an empty or same-origin relative path.');
  }
  return { apiMode, apiBaseUrl };
}

export const runtimeConfig = readRuntimeConfig({
  ...(import.meta.env.VITE_API_MODE ? { mode: import.meta.env.VITE_API_MODE } : {}),
  ...(import.meta.env.VITE_PUBLIC_API_BASE_URL
    ? { baseUrl: import.meta.env.VITE_PUBLIC_API_BASE_URL }
    : {}),
  production: import.meta.env.PROD,
});
