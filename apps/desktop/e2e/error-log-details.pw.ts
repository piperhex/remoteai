import { expect, test, type Page } from '@playwright/test';
import type { ErrorLogEntry } from '../src/api/errorLogs';

const entries: ErrorLogEntry[] = [
  { id: 3, createdAt: '2026-11-12T01:45:21Z', source: 'codex', statusCode: null,
    message: 'Codex CLI [fetch release information]: HTTP status client error (403 rate limit exceeded) '
      + 'for url (https://api.github.com/repos/openai/codex/releases/latest)' },
  { id: 2, createdAt: '2026-11-12T01:43:53Z', source: 'proxy', statusCode: 502,
    message: 'Upstream failed: https://example.com/responses?token=example-token; Authorization: Bearer example-key' },
  { id: 1, createdAt: '2026-11-12T01:43:38Z', source: 'toast', statusCode: null,
    message: 'Saved: C:\\Users\\Example User\\auth.json; api_key=sk-example' },
];

async function mockLogTransport(page: Page, transport: 'desktop' | 'hosted') {
  if (transport === 'desktop') {
    await page.addInitScript((records) => {
      Reflect.set(window, '__TAURI_INTERNALS__', {
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command !== 'list_error_logs') return [];
          const filtered = records.filter(entry => !args.source || entry.source === args.source);
          return { entries: filtered, total: filtered.length, page: 1, hasMore: false, snapshotId: 3 };
        },
      });
    }, entries);
    return;
  }
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args } = route.request().postDataJSON();
    const filtered = entries.filter(entry => !args.source || entry.source === args.source);
    const result = command === 'list_error_logs'
      ? { entries: filtered, total: filtered.length, page: 1, hasMore: false, snapshotId: 3 } : [];
    await route.fulfill({ json: { ok: true, result } });
  });
}

for (const transport of ['desktop', 'hosted'] as const) {
  for (const width of [1440, 900]) {
    test(`original log details via ${transport} at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await mockLogTransport(page, transport);
      await page.goto('/e2e/error-diagnostics-harness.html?logs');
      const table = page.locator('.ant-table-body');
      for (const entry of entries) await expect(table).toContainText(entry.message);
      await expect(table).not.toContainText('[已隐藏]');
      await page.screenshot({ path: info.outputPath(`${transport}-light-log-table-${width}.png`),
        animations: 'disabled' });
      await page.getByRole('button', { name: '查看', exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(JSON.parse((await dialog.locator('pre').textContent())!)).toEqual(entries[0]);
      await expect(page.locator('.ant-modal')).toHaveCSS('transform', 'none');
      await expect(page.locator('.ant-modal')).not.toHaveClass(/ant-zoom/);
      await expect(dialog).toBeInViewport();
      await page.screenshot({ path: info.outputPath(`${transport}-light-raw-log-${width}.png`),
        animations: 'disabled' });
      await dialog.getByRole('button', { name: /关\s*闭/ }).click();
      await page.getByText('Codex CLI', { exact: true }).first().click();
      await expect(table).toContainText(entries[0].message);
      await expect(table).not.toContainText(entries[1].message);
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await expect(table).toContainText(entries[0].message);
    });
  }
}
