import createClient from 'openapi-fetch';
import type { paths } from './schema';
import type { PublicApi } from './public-api';
import { ArchiveError } from '../../domain/institutions/errors';
import {
  isInstitution,
  isMetadata,
  isSource,
  isTimeline,
  validateDetail,
  validateList,
} from './validation';

export function createRealPublicApi(baseUrl: string): PublicApi {
  const client = createClient<paths>({ baseUrl });
  async function safe<T>(
    signal: AbortSignal | undefined,
    request: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 10_000);
    try {
      return await request(controller.signal);
    } catch (error) {
      if (
        error instanceof ArchiveError ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        throw error;
      throw new ArchiveError(error instanceof SyntaxError ? 'invalid-response' : 'network');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  function requireSuccess(response: Response) {
    if (response.ok) return;
    const rawId = response.headers.get('x-request-id');
    const requestId = rawId && /^[a-zA-Z0-9_-]{8,120}$/.test(rawId) ? rawId : undefined;
    const kind =
      response.status === 404
        ? 'not-found'
        : response.status === 400
          ? 'validation'
          : response.status === 429
            ? 'rate-limited'
            : 'unavailable';
    // No server error text or response body is reflected into the UI.
    throw new ArchiveError(kind, requestId);
  }
  return {
    list: (params, signal) =>
      safe(signal, async (requestSignal) => {
        const result = await client.GET('/api/v1/public/institutions', {
          params: { query: params },
          signal: requestSignal,
        });
        requireSuccess(result.response);
        return validateList(result.data, isInstitution);
      }),
    get: (slug, signal) =>
      safe(signal, async (requestSignal) => {
        const result = await client.GET('/api/v1/public/institutions/{slug}', {
          params: { path: { slug } },
          signal: requestSignal,
        });
        requireSuccess(result.response);
        return validateDetail(result.data, isInstitution);
      }),
    metadata: (signal) =>
      safe(signal, async (requestSignal) => {
        const result = await client.GET('/api/v1/public/metadata', {
          signal: requestSignal,
        });
        requireSuccess(result.response);
        return validateDetail(result.data, isMetadata);
      }),
    timeline: (slug, params, signal) =>
      safe(signal, async (requestSignal) => {
        const result = await client.GET('/api/v1/public/institutions/{slug}/timeline', {
          params: { path: { slug }, query: params },
          signal: requestSignal,
        });
        requireSuccess(result.response);
        return validateList(result.data, isTimeline);
      }),
    sources: (slug, params, signal) =>
      safe(signal, async (requestSignal) => {
        const result = await client.GET('/api/v1/public/institutions/{slug}/sources', {
          params: { path: { slug }, query: params },
          signal: requestSignal,
        });
        requireSuccess(result.response);
        return validateList(result.data, isSource);
      }),
    source: (id, signal) =>
      safe(signal, async (requestSignal) => {
        const result = await client.GET('/api/v1/public/sources/{id}', {
          params: { path: { id } },
          signal: requestSignal,
        });
        requireSuccess(result.response);
        return validateDetail(result.data, isSource);
      }),
  };
}
