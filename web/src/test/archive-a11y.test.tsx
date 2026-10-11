import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type Location,
  type NavigateFunction,
  type To,
} from 'react-router-dom';
import { AppProviders } from '../app/providers';
import { AppShell } from '../components/layout/AppShell';
import { SearchForm } from '../components/common/SearchForm';
import { InstitutionsPage } from '../pages/public/InstitutionsPage';
import { createArchiveService } from '../domain/institutions/service';
import { ArchiveError } from '../domain/institutions/errors';
import type { InstitutionQuery } from '../domain/institutions/models';

const originalTitle = document.title;
afterEach(() => {
  document.title = originalTitle;
});

function NavigationProbe({
  onUpdate,
}: {
  onUpdate: (location: Location, navigate: NavigateFunction) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => onUpdate(location, navigate), [location, navigate, onUpdate]);
  return null;
}

// An isolated fictional domain boundary: no production sessions, network or shared mocks.
function renderDirectory(path = '/institutions?q=fictional-first') {
  const list = vi.fn(async (query: InstitutionQuery) => ({
    records: [],
    page: query.page,
    pageSize: query.pageSize,
    total: 0,
    totalPages: 0,
  }));
  const unavailable = async () => {
    throw new ArchiveError('not-found');
  };
  const service = createArchiveService({
    list,
    metadata: async () => ({
      regions: [],
      evidenceStatuses: [],
      riskTags: [],
      operatingStatuses: [],
    }),
    get: unavailable,
    timeline: unavailable,
    sources: unavailable,
    source: unavailable,
  });
  let navigate: NavigateFunction | undefined;
  let location: Location | undefined;
  const router = {
    get state() {
      if (!location) throw new Error('Test navigation not ready');
      return { location };
    },
    navigate(to: To | number) {
      if (!navigate) throw new Error('Test navigation not ready');
      return typeof to === 'number' ? navigate(to) : navigate(to);
    },
  };
  const update = (next: Location, navigation: NavigateFunction) => {
    location = next;
    navigate = navigation;
  };
  const view = render(
    <AppProviders service={service}>
      <MemoryRouter initialEntries={[path]}>
        <NavigationProbe onUpdate={update} />
        <Routes>
          <Route element={<AppShell isMock />}>
            <Route path="/" element={<h1>虚构首页</h1>} />
            <Route path="/archive" element={<h1>虚构首页</h1>} />
            <Route path="/institutions" element={<InstitutionsPage />} />
            <Route path="/institutions/:slug" element={<h1>虚构档案</h1>} />
            <Route path="*" element={<h1>未找到可公开的页面</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
  return { ...view, router, list };
}

function searchbox() {
  return screen.getByRole('searchbox', { name: '搜索机构名称或别名' });
}

describe('search draft and focus regression', () => {
  it('syncs changed props without remounting while preserving edits on unrelated renders', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const view = render(<SearchForm initialValue="fictional-first" onSearch={onSearch} />);
    const input = searchbox();
    await user.clear(input);
    await user.type(input, '  虚构编辑草案  ');
    view.rerender(<SearchForm initialValue="fictional-first" onSearch={onSearch} />);
    expect(searchbox()).toBe(input);
    expect(input).toHaveValue('  虚构编辑草案  ');
    expect(input).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('虚构编辑草案');
    expect(input).toHaveFocus();
    view.rerender(<SearchForm initialValue="fictional-returned" onSearch={onSearch} />);
    expect(searchbox()).toBe(input);
    expect(input).toHaveValue('fictional-returned');
    expect(input).toHaveFocus();
    view.rerender(<SearchForm initialValue="" onSearch={onSearch} />);
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });
  it('keeps the same input focused after directory Enter submission and URL refresh', async () => {
    const user = userEvent.setup();
    const { router } = renderDirectory();
    await screen.findByRole('heading', { name: '没有匹配的公开档案' });
    const input = searchbox();
    await user.clear(input);
    await user.type(input, 'fictional-second');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.search).toContain('q=fictional-second'));
    expect(searchbox()).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('fictional-second');
    expect(document.title).toBe('机构名录 | Guardian 公共档案');
  });
  it('preserves the focused submit button instead of remounting on search', async () => {
    const user = userEvent.setup();
    const { router } = renderDirectory();
    await screen.findByRole('heading', { name: '没有匹配的公开档案' });
    await user.clear(searchbox());
    await user.type(searchbox(), 'fictional-button');
    const button = screen.getByRole('button', { name: /查询档案/ });
    await user.click(button);
    await waitFor(() => expect(router.state.location.search).toContain('q=fictional-button'));
    expect(screen.getByRole('button', { name: /查询档案/ })).toBe(button);
    expect(button).toHaveFocus();
  });
  it('restores URL query on Back/Forward but retains draft/focus for sort and paging changes', async () => {
    const user = userEvent.setup();
    const { router } = renderDirectory();
    await screen.findByRole('heading', { name: '没有匹配的公开档案' });
    const input = searchbox();
    await user.clear(input);
    await user.type(input, 'fictional-second');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.search).toContain('q=fictional-second'));
    await user.clear(input);
    await user.type(input, 'fictional-unsubmitted-draft');
    await act(async () => {
      await router.navigate('/institutions?q=fictional-second&sort=name_asc&page=2');
    });
    expect(input).toHaveValue('fictional-unsubmitted-draft');
    expect(input).toHaveFocus();
    await act(async () => {
      await router.navigate(-1);
    });
    expect(input).toHaveValue('fictional-unsubmitted-draft');
    await act(async () => {
      await router.navigate(-1);
    });
    expect(input).toHaveValue('fictional-first');
    expect(input).toHaveFocus();
    await act(async () => {
      await router.navigate(1);
    });
    expect(input).toHaveValue('fictional-second');
    expect(input).toHaveFocus();
    expect(searchbox()).toBe(input);
  });
  it('does not submit while editing and offers an accessible labelled search control', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchForm initialValue="" onSearch={onSearch} />);
    expect(screen.getByRole('search')).toContainElement(searchbox());
    expect(searchbox()).toHaveAttribute('maxLength', '100');
    await user.type(searchbox(), '虚构草案');
    expect(onSearch).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole('button', { name: /查询档案/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('虚构草案');
  });
});

describe('route accessibility regression', () => {
  it('focuses the unique main and updates only fixed public titles on pathname navigation', async () => {
    const { router } = renderDirectory('/');
    const main = screen.getByRole('main');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabIndex', '-1');
    expect(main).toHaveFocus();
    expect(screen.getByRole('link', { name: '跳至主要内容' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(document.title).toBe('公共档案首页 | Guardian 公共档案');
    await act(async () => {
      await router.navigate('/institutions?q=fictional-private-probe');
    });
    expect(main).toHaveFocus();
    expect(document.title).toBe('机构名录 | Guardian 公共档案');
    await act(async () => {
      await router.navigate('/institutions/fictional-private-probe?q=fictional-private-probe');
    });
    expect(main).toHaveFocus();
    expect(document.title).toBe('机构档案 | Guardian 公共档案');
    expect(document.title).not.toContain('fictional-private-probe');
    await act(async () => {
      await router.navigate('/fictional-private-probe');
    });
    expect(main).toHaveFocus();
    expect(document.title).toBe('页面不可用 | Guardian 公共档案');
    await act(async () => {
      await router.navigate('/archive');
    });
    expect(document.title).toBe('公共档案首页 | Guardian 公共档案');
  });
  it('does not steal search focus or change title on query or fragment refresh', async () => {
    const user = userEvent.setup();
    const { router } = renderDirectory();
    await screen.findByRole('heading', { name: '没有匹配的公开档案' });
    const input = searchbox();
    await user.click(input);
    await act(async () => {
      await router.navigate('/institutions?q=fictional-returned#section');
    });
    expect(input).toHaveValue('fictional-returned');
    expect(input).toHaveFocus();
    expect(document.title).toBe('机构名录 | Guardian 公共档案');
    await act(async () => {
      await router.navigate('/institutions?q=fictional-returned#another-section');
    });
    expect(input).toHaveFocus();
  });
  it('keeps directory form/sort/page controls named and results announced', async () => {
    renderDirectory();
    await screen.findByRole('heading', { name: '没有匹配的公开档案' });
    expect(screen.getByRole('navigation', { name: '主要导航' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '排序' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '每页' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '查询结果' })).toHaveAttribute('aria-busy', 'false');
    const count = screen
      .getAllByRole('status')
      .find((status) => status.textContent === '0 份匹配档案');
    expect(count).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('heading', { level: 1, name: '风险机构名录' })).toBeInTheDocument();
  });
});

// Source guards are not real layout/computed-font/browser accessibility evidence.
describe('semantic typography and reflow source regression', () => {
  const css = readFileSync(resolve('src/styles/globals.css'), 'utf8');
  it('keeps semantic text minima without reducing the root size', () => {
    expect(css).toContain('--text-body: 1rem;');
    expect(css).toContain('--text-control: 1rem;');
    expect(css).toContain('--text-critical: 1rem;');
    expect(css).toContain('--text-meta: 0.875rem;');
    for (const [, amount, unit] of css.matchAll(/font-size:\s*(\d*\.?\d+)(rem|px)\s*;/g))
      expect(Number(amount) * (unit === 'rem' ? 16 : 1)).toBeGreaterThanOrEqual(14);
    for (const [, rules] of css.matchAll(/(?:^|\n)(?:html|:root)\s*\{([^}]+)\}/g))
      expect(rules).not.toMatch(/font-size:/);
    expect(css).not.toMatch(/transform:\s*scale\(/);
    expect(css).not.toMatch(/min-width:\s*390px/);
  });
  it('protects summaries, evidence, safety copy and controls instead of badges alone', () => {
    expect(css).toMatch(/\.institution-summary\s*\{[^}]*font-size: var\(--text-body\)/);
    expect(css).toMatch(/\.source-list p\s*\{[^}]*font-size: var\(--text-body\)/);
    expect(css).toMatch(/\.badge\s*\{[^}]*font-size: var\(--text-critical\)/);
    expect(css).toMatch(/\.filter-field\s*\{[^}]*font-size: var\(--text-control\)/);
    expect(css).toMatch(/\.button\s*\{[^}]*font-size: var\(--text-control\)/);
    for (const selector of [
      '.mock-banner',
      '.dossier-footnote',
      '.trust-strip span',
      '.scope-notice',
      '.filter-dialog > p',
      '.footer-grid p',
    ])
      expect(css).toContain(selector === '.footer-grid p' ? `${selector} {` : `${selector},`);
    expect(css).toMatch(/\.footer-grid p\s*\{[^}]*font-size: var\(--text-critical\)/);
  });
  it('allows wrapping/shrinking and narrow-screen single columns without clipping controls', () => {
    expect(css).toMatch(/\.search-form\s*\{[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.search-form label\s*\{[^}]*min-width: 0/);
    expect(css).toMatch(/\.button\s*\{[^}]*white-space: normal/);
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(css).toMatch(/\.filter-dialog\s*\{[^}]*overflow: auto/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
