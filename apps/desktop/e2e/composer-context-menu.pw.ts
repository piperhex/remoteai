import { expect, test, type Locator, type Page } from '@playwright/test';

const labels = ['撤销', '重做', '剪切', '复制', '粘贴', '删除', '全选'];
const menu = (page: Page) => page.getByRole('menu', { name: '文本操作' });
const action = (page: Page, name: string) => menu(page).getByRole('menuitem', { name, exact: true });
const webURL = process.env.COMPOSER_TEST_WEB_URL ?? 'http://127.0.0.1:1486/web/';
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

async function text(input: Locator) {
  return input.evaluate(node => {
    if (node instanceof HTMLTextAreaElement) return node.value;
    // Chromium keeps a layout-only BR in an emptied contenteditable.
    return node.textContent ? (node as HTMLElement).innerText : '';
  });
}
async function select(input: Locator, start: number, end: number) {
  await input.evaluate((node, range) => {
    (node as HTMLElement).focus();
    if (node instanceof HTMLTextAreaElement) node.setSelectionRange(range.start, range.end);
    else {
      const selection = document.createRange();
      selection.setStart(node.firstChild!, range.start); selection.setEnd(node.firstChild!, range.end);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(selection);
    }
  }, { start, end });
}
async function open(page: Page, input: Locator, touch = false) {
  await expect(menu(page)).toBeHidden();
  if (!touch) await input.click({ button: 'right' });
  else {
    const bounds = (await input.boundingBox())!;
    const pointer = { pointerId: 8, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: bounds.x + 20, clientY: bounds.y + 12 };
    await input.dispatchEvent('pointerdown', pointer);
    await expect(menu(page)).toBeVisible();
    await input.dispatchEvent('pointerup', pointer);
  }
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('menuitem')).toHaveText(labels);
}
async function screenshot(page: Page, name: string) {
  await action(page, '粘贴').hover();
  await expect(page.locator('.ant-dropdown:visible').filter({ has: menu(page) })).toHaveCSS('opacity', '1');
  await page.screenshot({ path: `../../.codex-tmp/${name}.png`, animations: 'disabled' });
}

for (const mode of ['local', 'remote', 'web']) {
  test.describe(mode, () => {
    test.beforeEach(async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.route('https://fonts.googleapis.com/**', route => route.abort());
      await page.goto(mode === 'web' ? `${webURL}e2e/composer-context-menu-harness.html?mode=web`
        : `/e2e/project-reference-harness.html?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    });

    test('empty input, selection editing, undo, touch and keyboard menus', async ({ page }) => {
      const input = page.getByRole('textbox', { name: mode === 'local' ? '消息' : '聊天消息', exact: true });
      await page.evaluate(() => navigator.clipboard.writeText('你好，剪贴板'));
      await open(page, input);
      await expect(action(page, '复制')).toHaveAttribute('aria-disabled', 'true');
      await expect(action(page, '全选')).toHaveAttribute('aria-disabled', 'true');
      await expect(action(page, '粘贴')).not.toHaveAttribute('aria-disabled', 'true');
      await screenshot(page, `composer-menu-${mode}-empty-light`);
      await action(page, '粘贴').click();
      await expect.poll(() => text(input)).toBe('你好，剪贴板');
      if (mode !== 'local') await expect(page.locator('.chat-composer-placeholder')).toBeHidden();
      await expect(input).toBeFocused();
      await open(page, input); await action(page, '撤销').click();
      await expect.poll(() => text(input)).toBe('');
      await open(page, input); await action(page, '重做').click();
      await expect.poll(() => text(input)).toBe('你好，剪贴板');
      await select(input, 0, 2); await open(page, input);
      await action(page, '复制').click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('你好');
      await select(input, 0, 2); await open(page, input); await action(page, '剪切').click();
      await expect.poll(() => text(input)).toBe('，剪贴板');
      await page.evaluate(() => navigator.clipboard.writeText('替换'));
      await select(input, 1, 4); await open(page, input); await action(page, '粘贴').click();
      await expect.poll(() => text(input)).toBe('，替换');
      await open(page, input); await action(page, '全选').click();
      await open(page, input); await action(page, '删除').click();
      await expect.poll(() => text(input)).toBe('');
      await open(page, input, true);
      await action(page, '粘贴').click();
      await expect.poll(() => text(input)).toBe('替换');
      await open(page, input, true);
      await screenshot(page, `composer-menu-${mode}-touch-light`);
      await page.keyboard.press('Escape');
      await input.press('Shift+F10'); await expect(menu(page)).toBeVisible();
      await page.keyboard.press('Escape'); await expect(menu(page)).toBeHidden();
      await expect(input).toBeFocused();
      await input.pressSequentially('继续输入');
      await expect.poll(() => text(input)).toContain('继续输入');
      await page.setViewportSize({ width: 900, height: 680 });
      await input.press('Control+a');
      await open(page, input);
      const bounds = (await menu(page).boundingBox())!;
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(680);
      await screenshot(page, `composer-menu-${mode}-selected-compact`);
    });

    test('pastes images and long text through the attachment pipeline', async ({ page }) => {
      const input = page.getByRole('textbox', { name: mode === 'local' ? '消息' : '聊天消息', exact: true });
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20;
        const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      });
      await open(page, input); await action(page, '粘贴').click();
      await expect(page.getByRole('button', { name: /移除图片/ })).toHaveCount(1);
      await page.evaluate(() => navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob(['<b>富文本</b><br>下一行'], { type: 'text/html' }),
      })]));
      await open(page, input); await action(page, '粘贴').click();
      await expect.poll(() => text(input)).toBe('富文本\n下一行');
      await input.fill('');
      const pasted = '长文本内容\n'.repeat(3000);
      await page.evaluate(value => navigator.clipboard.writeText(value), pasted);
      await open(page, input); await action(page, '粘贴').click();
      await expect(page.getByRole('button', { name: /移除附件：pasted-text-/ })).toHaveCount(1);
      await expect.poll(() => text(input)).toBe('');
    });

    test('clipboard denial stays actionable in dark mode', async ({ page }) => {
      await page.goto(page.url() + '&dark');
      const input = page.getByRole('textbox', { name: mode === 'local' ? '消息' : '聊天消息', exact: true });
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { read: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } }));
      await open(page, input); await action(page, '粘贴').click();
      await expect(page.getByRole('alert')).toHaveText('无法读取剪贴板，请使用粘贴快捷键。');
      expect((await page.getByRole('alert').boundingBox())!.width).toBeLessThanOrEqual(400);
      await screenshot(page, `composer-menu-${mode}-denied-dark`);
      await page.keyboard.press('Escape'); await expect(menu(page)).toBeHidden();
    });

    test('dismissed clipboard reads cannot replace a newer draft', async ({ page }) => {
      const input = page.getByRole('textbox', { name: mode === 'local' ? '消息' : '聊天消息', exact: true });
      await input.fill('原始草稿');
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { read: () => new Promise<ClipboardItem[]>(resolve => {
          window.addEventListener('finish-test-paste', () => {
            document.body.dataset.clipboardRead = 'resolved';
            resolve([new ClipboardItem({ 'text/plain': new Blob(['过期粘贴'], { type: 'text/plain' }) })]);
          }, { once: true });
        }) } }));
      await open(page, input); await action(page, '粘贴').click();
      await page.keyboard.press('Escape'); await expect(menu(page)).toBeHidden();
      await input.fill('新的草稿');
      await page.evaluate(() => window.dispatchEvent(new Event('finish-test-paste')));
      await expect(page.locator('body')).toHaveAttribute('data-clipboard-read', 'resolved');
      await expect.poll(() => text(input)).toBe('新的草稿');
    });
  });
}
