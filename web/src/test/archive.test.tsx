import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppProviders } from '../app/providers';
import { AppRoutes } from '../app/router';
import { createArchiveService } from '../domain/institutions/service';
import { createInstitutionAdapter } from '../lib/api/institution-adapter';
import { createMockPublicApi } from '../mocks/public-api';

function renderApp(path = '/', fail = false) {
  const service = createArchiveService(
    createInstitutionAdapter(createMockPublicApi({ delayMs: 0, fail })),
  );
  return render(
    <AppProviders service={service}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes isMock />
      </MemoryRouter>
    </AppProviders>,
  );
}
describe('public Archive UI', () => {
  it('shows loading and goes from homepage alias search to detail', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(screen.getByText('正在查阅档案…')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: '虚构示例·雾港成长中心' }),
    ).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), '雾港旧称');
    await user.click(screen.getByRole('button', { name: /查询档案/ }));
    expect(await screen.findByRole('heading', { name: '风险机构名录' })).toBeInTheDocument();
    await user.click(await screen.findByRole('link', { name: '虚构示例·雾港成长中心' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: '虚构示例·雾港成长中心' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('链接尚未核验')).toBeInTheDocument();
  });
  it('shows neutral empty and safe errors with retry', async () => {
    const view = renderApp('/institutions?q=没有匹配的虚构机构');
    expect(await screen.findByRole('heading', { name: '没有匹配的公开档案' })).toBeInTheDocument();
    view.unmount();
    renderApp('/', true);
    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用');
    expect(screen.getByRole('button', { name: '重新尝试' })).toBeInTheDocument();
  });
  it('uses the same safe 404 for withdrawn/hidden/unknown resources', async () => {
    renderApp('/institutions/fictional-withdrawn');
    expect(await screen.findByRole('heading', { name: '未找到可公开的页面' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '身份与资料范围' })).not.toBeInTheDocument();
  });
});
