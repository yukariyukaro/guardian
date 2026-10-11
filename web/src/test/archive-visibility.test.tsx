import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { createArchiveQueryClient, isKnownUnavailable } from '../app/archive-query-client';
import { ArchiveServiceContext } from '../app/services-context';
import { AppRoutes } from '../app/router';
import { createArchiveService } from '../domain/institutions/service';
import { createInstitutionAdapter } from '../lib/api/institution-adapter';
import { createMockPublicApi } from '../mocks/public-api';
import { ArchiveError } from '../domain/institutions/errors';
import type { InstitutionRepository, PageResult } from '../domain/institutions/models';

const slug = 'fictional-mist-harbor-center';
const name = '虚构示例·雾港成长中心';
const repository = () => createInstitutionAdapter(createMockPublicApi({ delayMs: 0 }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mount(repo: InstitutionRepository, path = `/institutions/${slug}`) {
  const client = createArchiveQueryClient();
  const view = render(
    <ArchiveServiceContext.Provider value={createArchiveService(repo)}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes isMock />
        </MemoryRouter>
      </QueryClientProvider>
    </ArchiveServiceContext.Provider>,
  );
  return { ...view, client };
}

describe('archive visibility and complete detail reads', () => {
  it.each(['get', 'timeline', 'sources'] as const)(
    'fails closed when %s returns public 404',
    async (method) => {
      const base = repository();
      const repo = { ...base, [method]: vi.fn().mockRejectedValue(new ArchiveError('not-found')) };
      const { client } = mount(repo);
      expect(
        await screen.findByRole('heading', { name: '未找到可公开的页面' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name, level: 1 })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '公开事件时间线' })).not.toBeInTheDocument();
      expect(isKnownUnavailable(client, slug)).toBe(true);
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: ['archive', 'institutions', 'dossier', slug] })
          .every((query) => query.state.data === undefined),
      ).toBe(true);
    },
  );

  it.each(['timeline', 'sources'] as const)(
    'removes a previously successful dossier when %s becomes unavailable',
    async (method) => {
      const base = repository();
      let unavailable = false;
      const repo: InstitutionRepository = {
        ...base,
        [method]: async (
          key: string,
          query: { page: number; pageSize: number },
          signal?: AbortSignal,
        ) => {
          if (unavailable) throw new ArchiveError('not-found');
          return base[method](key, query, signal);
        },
      };
      const { client } = mount(repo);
      await screen.findByRole('heading', { name, level: 1 });
      unavailable = true;
      await act(async () => {
        await client.refetchQueries({ queryKey: ['archive', 'institutions', 'dossier', slug] });
      });
      expect(
        await screen.findByRole('heading', { name: '未找到可公开的页面' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name, level: 1 })).not.toBeInTheDocument();
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: ['archive', 'institutions', 'dossier', slug] })
          .every((query) => query.state.data === undefined),
      ).toBe(true);
    },
  );

  it.each(['dossier', 'sourceReference'] as const)(
    'prioritizes a late parent 404 over an early network error in %s',
    async (operation) => {
      const base = repository();
      const gate = deferred<Awaited<ReturnType<typeof base.get>>>();
      const service = createArchiveService({
        ...base,
        get: async () => {
          await gate.promise;
          throw new ArchiveError('not-found');
        },
        timeline: async () => {
          throw new ArchiveError('network');
        },
        source: async () => {
          throw new ArchiveError('network');
        },
      });
      const client = createArchiveQueryClient();
      const result = client
        .fetchQuery({
          queryKey: [
            'archive',
            'institutions',
            operation === 'dossier' ? 'dossier' : 'source-reference',
            slug,
          ],
          queryFn: (): Promise<unknown> =>
            operation === 'dossier'
              ? service.dossier(slug, { page: 1, pageSize: 20 }, { page: 1, pageSize: 20 })
              : service.sourceReference(slug, 'src-fictional-page-21'),
        })
        .catch((error: unknown) => error);
      gate.resolve(await base.get(slug));
      expect(await result).toMatchObject({ kind: 'not-found' });
      expect(isKnownUnavailable(client, slug)).toBe(true);
      client.clear();
    },
  );

  it('does not display cached dossier content when offline revalidation is paused', async () => {
    const user = userEvent.setup();
    const base = repository();
    const get = vi.fn(base.get);
    const { client } = mount({ ...base, get });
    await screen.findByRole('heading', { name, level: 1 });
    await user.click(screen.getByRole('link', { name: '返回机构名录' }));
    await screen.findByRole('link', { name });
    try {
      onlineManager.setOnline(false);
      get.mockClear();
      await user.click(screen.getByRole('link', { name }));
      await waitFor(() =>
        expect(
          client
            .getQueryCache()
            .findAll({ queryKey: ['archive', 'institutions', 'dossier', slug] })[0]?.state
            .fetchStatus,
        ).toBe('paused'),
      );
      expect(get).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name, level: 1 })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '公开事件时间线' })).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('不会显示缓存内容');
    } finally {
      await act(async () => {
        onlineManager.setOnline(true);
        await client.cancelQueries();
      });
      client.clear();
    }
  });

  it('starts all three reads in parallel and does not expose a partial dossier', async () => {
    const base = repository();
    const gate = deferred<Awaited<ReturnType<typeof base.get>>>();
    const get = vi.fn(() => gate.promise);
    const timeline = vi.fn(base.timeline);
    const sources = vi.fn(base.sources);
    mount({ ...base, get, timeline, sources });
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(1));
    expect(sources).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: '公开事件时间线' })).not.toBeInTheDocument();
    await act(async () => gate.resolve(await base.get(slug)));
    expect(await screen.findByRole('heading', { name, level: 1 })).toBeInTheDocument();
  });

  it('evicts successful dossier and list data after refetch 404 and prevents history resurrection', async () => {
    const user = userEvent.setup();
    const base = repository();
    let unavailable = false;
    const listGate = deferred<Awaited<ReturnType<typeof base.list>>>();
    const repo: InstitutionRepository = {
      ...base,
      get: async (key, signal) => {
        if (unavailable) throw new ArchiveError('not-found');
        return base.get(key, signal);
      },
      list: (query, signal) => (unavailable ? listGate.promise : base.list(query, signal)),
    };
    const { client } = mount(repo, '/institutions');
    await user.click(await screen.findByRole('link', { name }));
    expect(await screen.findByRole('heading', { name, level: 1 })).toBeInTheDocument();
    unavailable = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['archive', 'institutions', 'dossier', slug] });
    });
    expect(await screen.findByRole('heading', { name: '未找到可公开的页面' })).toBeInTheDocument();
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ['archive', 'institutions', 'list'] })
        .every((query) => query.state.data === undefined),
    ).toBe(true);
    await user.click(screen.getByRole('link', { name: '返回机构名录' }));
    expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    // A response started before withdrawal cannot repopulate public cache with this record.
    await act(async () =>
      listGate.resolve(
        await base.list({
          q: '',
          region: '',
          riskTag: '',
          evidenceStatus: '',
          operatingStatus: '',
          sort: 'updated_desc',
          page: 1,
          pageSize: 20,
        }),
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用');
    expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
  });

  it('can page through 21 events/sources and resolve a source outside the current page', async () => {
    const user = userEvent.setup();
    const base = repository();
    const source = (await base.sources(slug, { page: 1, pageSize: 20 })).records[0]!;
    const firstEvents = await base.timeline(slug, { page: 1, pageSize: 20 });
    const events = Array.from({ length: 21 }, (_, index) => ({
      ...firstEvents.records[0]!,
      id: `evt-fictional-page-${index + 1}`,
      title: `虚构事件 ${index + 1}`,
      sourceIds: ['src-fictional-page-21'],
    }));
    const sources = Array.from({ length: 21 }, (_, index) => ({
      ...source,
      id: `src-fictional-page-${index + 1}`,
      title: `虚构来源 ${index + 1}`,
    }));
    const page = <T,>(records: T[], number: number): PageResult<T> => ({
      records: records.slice((number - 1) * 20, number * 20),
      page: number,
      pageSize: 20,
      total: 21,
      totalPages: 2,
    });
    mount({
      ...base,
      timeline: async (_key, query) => page(events, query.page),
      sources: async (_key, query) => page(sources, query.page),
      source: async (id) => sources.find((item) => item.id === id)!,
    });
    await screen.findByRole('heading', { name, level: 1 });
    await user.click(
      screen.getAllByRole('button', { name: '查阅来源 · src-fictional-page-21（其他页）' })[0]!,
    );
    expect(await screen.findByRole('heading', { name: '虚构来源 21' })).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('navigation', { name: '来源分页' })).getByRole('button', {
        name: '下一页',
      }),
    );
    expect(await screen.findByText('虚构来源 21', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '公开来源索引' })).toHaveFocus();
    expect(
      screen.getAllByRole('link', { name: '来源 · src-fictional-page-21' })[0],
    ).toHaveAttribute('href', '#src-fictional-page-21');
    await user.click(
      within(screen.getByRole('navigation', { name: '时间线分页' })).getByRole('button', {
        name: '下一页',
      }),
    );
    expect(await screen.findByRole('heading', { name: '虚构事件 21' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '公开事件时间线' })).toHaveFocus();
    expect(screen.queryByRole('heading', { name: '虚构事件 1' })).not.toBeInTheDocument();
  });
});
