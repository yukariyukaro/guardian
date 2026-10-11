import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5187') await route.continue();
    else await route.abort('blockedbyclient');
  });
});

test('homepage → alias search → institution → timeline/source loop', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('虚构数据演示', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近更新的档案' })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索机构名称或别名' }).fill('雾港旧称');
  await page.getByRole('button', { name: '查询档案' }).click();
  await expect(page).toHaveURL(/institutions\?q=/);
  await page.getByRole('heading', { name: '虚构示例·雾港成长中心' }).getByRole('link').click();
  await expect(
    page.getByRole('heading', { level: 1, name: '虚构示例·雾港成长中心' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '公开事件时间线' })).toBeVisible();
  await expect(page.getByText('虚构示例·资料索引建立', { exact: true })).toBeVisible();
  await expect(page.getByText('链接尚未核验', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '返回机构名录' }).click();
  await expect(page.getByRole('heading', { name: '风险机构名录' })).toBeVisible();
});

test('filter and pagination survive reload, mobile has no horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/institutions?page_size=3');
  await expect(page.getByRole('status').filter({ hasText: '5 份匹配档案' })).toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.reload();
  await expect(page.getByText('第 2 页 / 共 2 页')).toBeVisible();
  await page.getByRole('button', { name: '筛选公开档案' }).click();
  await page
    .getByRole('dialog', { name: '缩小查询范围' })
    .getByRole('combobox', { name: '地区', exact: true })
    .selectOption('fictional-mist-region');
  await expect(page).not.toHaveURL(/region=/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '筛选公开档案' })).toBeFocused();
  await expect(page).not.toHaveURL(/region=/);
  await page.getByRole('button', { name: '筛选公开档案' }).click();
  await page
    .getByRole('dialog', { name: '缩小查询范围' })
    .getByRole('combobox', { name: '地区', exact: true })
    .selectOption('fictional-mist-region');
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect(page).toHaveURL(/region=fictional-mist-region/);
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.getByRole('status').filter({ hasText: '3 份匹配档案' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

for (const width of [320, 390, 768, 1024, 1280, 1440]) {
  test(`archive pages fit ${width}px and retain semantic navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/institutions', '/institutions/fictional-mist-harbor-center']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('navigation', { name: '主要导航' })).toBeVisible();
      await expect(page.getByRole('main')).toBeFocused();
      await expect(page).not.toHaveTitle('Guardian · 公共档案');
      if (path.includes('fictional-mist-harbor-center')) {
        await expect(page.getByText('链接尚未核验', { exact: true })).toBeVisible();
      }
      const smallText = await page
        .locator(
          'main p, main label, main button, main input, main select, main .badge, main .scope-notice',
        )
        .evaluateAll((elements) =>
          elements
            .filter((element) => element.getClientRects().length > 0)
            .map((element) => ({
              size: Number.parseFloat(getComputedStyle(element).fontSize),
              minimum: element.matches('.institution-side p') ? 14 : 16,
            }))
            .filter(({ size, minimum }) => size < minimum),
        );
      expect(smallText).toEqual([]);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
    }
  });
}

test('keyboard search keeps focus and URL history restores its draft', async ({ page }) => {
  await page.goto('/institutions');
  const input = page.getByRole('searchbox', { name: '搜索机构名称或别名' });
  await input.fill('雾港旧称');
  await input.press('Enter');
  await expect(page).toHaveURL(/q=/);
  await expect(input).toBeFocused();
  await expect(
    page.getByRole('link', { name: '虚构示例·雾港成长中心', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(input).toHaveValue('');
  await page.goForward();
  await expect(input).toHaveValue('雾港旧称');
});

test('200 percent text and user spacing preserve source and safety content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/institutions/fictional-mist-harbor-center');
  await expect(page.getByText('链接尚未核验', { exact: true })).toBeVisible();
  await page.addStyleTag({
    content:
      'html { font-size: 200% !important; } body { font-size: 2rem !important; } * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }',
  });
  await expect(page.getByRole('heading', { name: '公开来源索引' })).toBeVisible();
  await expect(page.locator('.scope-notice')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test('empty, nonpublic and unavailable-source states remain neutral', async ({ page }) => {
  await page.goto('/institutions?q=没有匹配的虚构机构');
  await expect(page.getByRole('heading', { name: '没有匹配的公开档案' })).toBeVisible();
  await page.goto('/institutions/fictional-withdrawn');
  await expect(page.getByRole('heading', { name: '未找到可公开的页面' })).toBeVisible();
  await page.goto('/institutions/fictional-paper-river-center');
  await expect(page.getByText('来源链接失效', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看原始来源（离开本站）' })).toHaveCount(0);
});
