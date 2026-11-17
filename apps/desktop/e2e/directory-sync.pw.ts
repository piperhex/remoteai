import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend } from './cli-gui-support';
import type { createDirectoryFixture } from '../../../shared/testing/directoryFixture';

const directoryFixtureThreads = Array.from({ length: 1500 }, (_, index) => ({
  id: `synthetic-${String(index).padStart(4, '0')}`, name: `测试对话 ${String(index).padStart(4, '0')}`,
  preview: '', cwd: index < 1000 ? '/fixture/recent' : '/fixture/history', updatedAt: 2000 - index,
}));

const evidence = resolve('../../.codex-tmp/directory-sync/screenshots');

for (const mode of ['local', 'remote', 'web', 'web-mobile']) {
  for (const large of [false, true]) {
    test(`${mode} scoped directory ${large ? 'enlarged dark' : 'default light'}`, async ({ page }) => {
      await mkdir(evidence, { recursive: true });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize(mode === 'web-mobile' ? { width: 390, height: 844 }
        : large ? { width: 960, height: 900 } : { width: 1440, height: 980 });
      await localBackend(page);
      await page.route('**/__codex_switch__/api/invoke', async (route, request) => {
        const { command, args = {} } = request.postDataJSON();
        if (command !== 'codex_gui_request') { await route.fallback(); return; }
        const body = args.request;
        let data: unknown;
        if (body.operation === 'list') {
          const offset = Number(body.cursor ?? 0);
          data = { data: directoryFixtureThreads.slice(offset, offset + 50),
            nextCursor: offset + 50 < directoryFixtureThreads.length ? String(offset + 50) : null };
        } else if (body.operation === 'groupThreadSummaries') {
          data = directoryFixtureThreads.filter(thread => body.threadIds.includes(thread.id));
        } else { await route.fallback(); return; }
        await route.fulfill({ json: { ok: true, result: { data } } });
      });
      await page.goto(`/e2e/directory-sync-harness.html?mode=${mode === 'web-mobile' ? 'web' : mode}${large ? '&large&dark' : ''}`);
      if (mode === 'web-mobile') await page.getByRole('button', { name: '打开聊天列表', exact: true }).click();
      await expect(page.getByRole('button', { name: '测试对话 0000', exact: true })).toBeVisible();
      const group = page.getByRole('button', { name: '折叠分组：历史分组（测试数据）', exact: true });
      await expect(group).toBeVisible();
      await expect(page.getByRole('button', { name: '测试对话 1000', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
      const label = `${mode}-${large ? '20px-dark-narrow' : '14px-light'}`;
      await page.screenshot({ path: resolve(evidence, `${label}-initial.png`), animations: 'disabled' });
      // Expanding the custom group loads its first page; paging controls live inside the expanded content.
      await page.getByRole('button', { name: /^展开显示(?:：历史分组（测试数据）)?$/, exact: true }).first().click();
      await expect(page.getByRole('button', { name: '测试对话 1000', exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(evidence, `${label}-group-loaded.png`), animations: 'disabled' });
      const more = page.getByRole('button', { name: '加载更多', exact: true }).first();
      const sizes = await more.evaluate(button => {
        const toggle = button.parentElement!.querySelector('button[aria-expanded="true"]')!;
        return { more: parseFloat(getComputedStyle(button.querySelector('span')!).fontSize),
          expand: parseFloat(getComputedStyle(toggle).fontSize) };
      });
      expect(Math.abs(sizes.expand - sizes.more - 1)).toBeLessThan(0.05);
      await more.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidence, `${label}-expanded-pagination.png`), animations: 'disabled' });
      if (mode !== 'local') {
        await expect.poll(() => page.evaluate(() => (window as unknown as {
          directoryController: { snapshot(): { loading: boolean } } }).directoryController.snapshot().loading)).toBe(false);
        const before = await page.evaluate(() => (window as unknown as { directoryFixture: ReturnType<typeof createDirectoryFixture> })
          .directoryFixture.metrics.length);
        await page.evaluate(() => (window as unknown as { directoryFixture: ReturnType<typeof createDirectoryFixture> })
          .directoryFixture.rename());
        await group.click();
        await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '改名已同步（测试）', exact: true })).toBeVisible();
        const after = await page.evaluate(() => (window as unknown as { directoryFixture: ReturnType<typeof createDirectoryFixture> })
          .directoryFixture.metrics.length);
        expect(after).toBe(before);
        await page.screenshot({ path: resolve(evidence, `${label}-single-update.png`), animations: 'disabled' });
      }
      expect(errors).toEqual([]);
    });
  }
}
