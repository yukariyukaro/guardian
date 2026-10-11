// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealPublicApi } from './real-public-api';
import { mockInstitutions } from '../../mocks/fixtures/institutions';
import { readRuntimeConfig } from '../../app/config';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('real public API fail-closed boundary', () => {
  it('uses contract paths and validates the successful payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: mockInstitutions[0] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await createRealPublicApi('https://example.invalid').get(
      'fictional-mist-harbor-center',
    );
    expect(result.data.slug).toBe('fictional-mist-harbor-center');
    const request: Request = fetchMock.mock.calls[0]?.[0];
    expect(request.url).toBe(
      'https://example.invalid/api/v1/public/institutions/fictional-mist-harbor-center',
    );
  });
  it('rejects malformed or nonpublic API data without mock fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { private_note: 'synthetic-private-field' } }), {
          status: 200,
        }),
      ),
    );
    await expect(
      createRealPublicApi('https://example.invalid').get('fictional-any'),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'synthetic-internal-message' } }), {
          status: 503,
          headers: { 'x-request-id': 'safe-request-123' },
        }),
      ),
    );
    await expect(
      createRealPublicApi('https://example.invalid').get('fictional-any'),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      requestId: 'safe-request-123',
      message: 'unavailable',
    });
  });
  it('rejects unexpected private fields even alongside otherwise valid public data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { ...mockInstitutions[0], internal_note: 'synthetic-private-probe' },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(
      createRealPublicApi('https://example.invalid').get('fictional-any'),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('passes related pagination and reads a referenced source through the contract path', async () => {
    const { mockSources, mockTimeline } = await import('../../mocks/fixtures/institutions');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: mockTimeline.slice(0, 1),
            pagination: { page: 2, page_size: 1, total: 2, total_pages: 2 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: mockSources.slice(0, 1),
            pagination: { page: 2, page_size: 1, total: 2, total_pages: 2 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: mockSources[0] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = createRealPublicApi('https://example.invalid');
    await api.timeline('fictional-mist-harbor-center', { page: 2, page_size: 1 });
    await api.sources('fictional-mist-harbor-center', { page: 2, page_size: 1 });
    await api.source(mockSources[0]!.id);
    expect((fetchMock.mock.calls[0]?.[0] as Request).url).toContain('/timeline?page=2&page_size=1');
    expect((fetchMock.mock.calls[1]?.[0] as Request).url).toContain('/sources?page=2&page_size=1');
    expect((fetchMock.mock.calls[2]?.[0] as Request).url).toContain(
      `/sources/${mockSources[0]!.id}`,
    );
  });
  it('classifies malformed successful JSON as an invalid response, not a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{synthetic broken JSON', { status: 200 })),
    );
    await expect(
      createRealPublicApi('https://example.invalid').get('fictional-any'),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
  });
  it('aborts a slow read at the bounded deadline without retaining its request', async () => {
    vi.useFakeTimers();
    let activeSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (request: Request) =>
          new Promise<Response>((_resolve, reject) => {
            activeSignal = request.signal;
            activeSignal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const result = createRealPublicApi('https://example.invalid')
      .get('fictional-any')
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(activeSignal?.aborted).toBe(true);
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['cancel', 'timeout'] as const)(
    'keeps %s active after response headers until the body is parsed',
    async (mode) => {
      vi.useFakeTimers();
      let activeSignal: AbortSignal | undefined;
      const controller = new AbortController();
      let parsing!: () => void;
      const bodyStarted = new Promise<void>((resolve) => {
        parsing = resolve;
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: Request) => {
          activeSignal = request.signal;
          const response = new Response(null, { status: 200 });
          vi.spyOn(response, 'json').mockImplementation(() => {
            parsing();
            return new Promise((_resolve, reject) => {
              request.signal.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true },
              );
            });
          });
          return response;
        }),
      );
      const result = createRealPublicApi('https://example.invalid')
        .get('fictional-any', controller.signal)
        .catch((error: unknown) => error);
      await bodyStarted;
      if (mode === 'cancel') controller.abort();
      else await vi.advanceTimersByTimeAsync(10_000);
      expect(activeSignal?.aborted).toBe(true);
      expect(await result).toMatchObject({ name: 'AbortError' });
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('forbids production mocks and external runtime origins', () => {
    expect(() => readRuntimeConfig({ mode: 'mock', production: true })).toThrow();
    expect(() =>
      readRuntimeConfig({ baseUrl: 'https://example.invalid', production: false }),
    ).toThrow();
    expect(() => readRuntimeConfig({ baseUrl: '//example.invalid', production: false })).toThrow();
    expect(readRuntimeConfig({ baseUrl: '/gateway/', production: true })).toEqual({
      apiMode: 'real',
      apiBaseUrl: '/gateway',
    });
  });
});
