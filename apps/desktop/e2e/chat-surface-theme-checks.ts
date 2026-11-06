import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export async function assertSurfaceReadable(nodes: Locator) {
  const results = await nodes.evaluateAll(elements => elements.map(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1, 1);
    for (const ancestor of ancestors) {
      context.fillStyle = getComputedStyle(ancestor).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const luminance = (pixels: Uint8ClampedArray) => {
      const [red, green, blue] = Array.from(pixels.slice(0, 3)).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * red + .7152 * green + .0722 * blue;
    };
    const background = luminance(context.getImageData(0, 0, 1, 1).data);
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    const foreground = luminance(context.getImageData(0, 0, 1, 1).data);
    return { text: element.textContent, contrast: (Math.max(background, foreground) + .05)
      / (Math.min(background, foreground) + .05), fits: element.scrollWidth <= element.clientWidth + 1 };
  }));
  expect(results.length).toBeGreaterThan(0);
  for (const result of results) {
    expect(result.contrast, `${result.text}: contrast`).toBeGreaterThanOrEqual(4.5);
    expect(result.fits, `${result.text}: overflow`).toBe(true);
  }
}

async function checkHealth(page: Page, info: TestInfo) {
  await page.getByRole('button', { name: 'P2P · 连接体验' }).click();
  const panel = page.locator('.connection-health-sheet');
  await expect(panel.locator('.connection-health-direct')).toBeVisible();
  await expect(panel).not.toHaveClass(/ant-zoom-(appear|enter)/);
  await assertSurfaceReadable(panel.locator('strong, h3, dt, dd span, p'));
  await page.screenshot({ path: info.outputPath('connection-health.png') });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
}

async function checkComputers(page: Page, info: TestInfo, local: boolean) {
  await page.getByRole('button', { name: local ? /^切换主机：/ : '选择电脑', exact: !local }).click();
  const panel = local ? page.locator('.ant-popover') : page.locator('.chat-device-picker');
  await expect(panel).not.toHaveClass(/ant-(zoom|slide|fade)[^\s]*-(appear|enter)/);
  const offline = panel.getByRole(local ? 'menuitemradio' : 'button', { name: /Offline PC/ });
  await expect(offline).toBeDisabled();
  await assertSurfaceReadable(panel.locator(local ? '[role=menuitemradio]:not(:disabled) span'
    : '.chat-setting-entry:not(:disabled) strong, .chat-setting-entry:not(:disabled) span'));
  const online = panel.getByRole(local ? 'menuitemradio' : 'button', { name: /Home PC/ });
  await online.hover();
  await assertSurfaceReadable(online.locator(local ? 'span' : 'strong, span'));
  await page.screenshot({ path: info.outputPath('computer-picker-hover.png') });
  const search = panel.getByRole('textbox', { name: '搜索主机', exact: true });
  if (await search.count()) {
    await search.fill('Home');
    await expect(offline).toHaveCount(0);
    await expect(online).toBeVisible();
  }
  await online.click();
  await expect(panel).toBeHidden();
}

async function checkCommands(page: Page, info: TestInfo, local: boolean) {
  const input = page.getByRole('textbox', { name: local ? '消息' : '聊天消息', exact: true });
  await input.fill('/');
  const selected = page.locator(local ? '[role=option][aria-selected=true]' : '[role=menuitem][aria-current=true]');
  if (local) await input.press('ArrowDown');
  await expect(selected).toContainText('目标');
  await assertSurfaceReadable(selected.locator('strong, small'));
  await page.screenshot({ path: info.outputPath('command-selected.png') });
  await input.fill('/design-review');
  await expect(selected).toContainText('design-review');
  await selected.hover();
  await assertSurfaceReadable(selected.locator('strong, small'));
  await page.screenshot({ path: info.outputPath('skill-selected-hover.png') });
  await input.press('Enter');
  await expect(selected).toHaveCount(0);
  if (local) await expect(input).toContainText('design-review');
  else await expect(input).toHaveValue('$design-review ');
}

export async function checkChatSurfaceTheme(page: Page, info: TestInfo, mode: string) {
  const local = mode === 'local';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('button', { name: '切换主题' })).toBeVisible();
  if (!local) await checkHealth(page, info);
  await checkComputers(page, info, local);
  await checkCommands(page, info, local);
  expect(errors).toEqual([]);
}
