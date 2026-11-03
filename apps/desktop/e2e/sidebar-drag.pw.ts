import { expect, test, type Locator, type Page } from '@playwright/test';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000, viewport: { width: 1280, height: 900 } });
const output = '../../.codex-tmp/sidebar-drag';
const source = (page: Page, id: string) => page.locator(`[data-chat-drag-id="${id}"]`);
const group = (page: Page, id: string) => page.locator(`[data-chat-drop-kind="group"][data-chat-drop-id="${id}"]`);
const project = (page: Page, cwd: string) => page.locator(`[data-chat-drop-kind="project"][data-chat-drop-id="${cwd}"]`);

async function hoverDrag(from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('Missing drag endpoint');
  const mouse = from.page().mouse;
  await mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await mouse.down();
  await mouse.move(start.x + start.width / 2 + 16, start.y + start.height / 2, { steps: 4 });
  await mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 16 });
}

async function saved(page: Page) {
  return page.evaluate(() => ({
    grouping: JSON.parse(localStorage.getItem('codex-switch:gui-custom-groups')!),
    preferences: JSON.parse(localStorage.getItem('codex-switch:gui') ?? '{}'),
  }));
}

async function expectReadableHighlight(target: Locator) {
  const contrast = await target.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const luminance = (color: string) => {
      context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const text = element.querySelector('button') ?? element;
    const foreground = luminance(getComputedStyle(text).color);
    const background = luminance(getComputedStyle(element).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

for (const mode of ['local', 'remote', 'web']) {
  for (const dark of [false, true]) {
    const label = `${mode}-desktop-${dark ? 'dark' : 'light'}`;
    test(`${label}: drag chats and projects into collapsed groups and move chats between projects`, async ({ page }) => {
      await page.goto(`/e2e/custom-groups-harness.html?mode=${mode}${dark ? '&dark' : ''}`);
      await group(page, 'research').getByRole('button', { name: '折叠分组：研究', exact: true }).click();
      await hoverDrag(source(page, 'design'), group(page, 'research'));
      await expect(group(page, 'research')).toHaveAttribute('data-chat-drop-active', 'true');
      await expectReadableHighlight(group(page, 'research'));
      await page.screenshot({ path: `${output}/${label}-thread-to-group.png`, animations: 'disabled' });
      await page.mouse.up();
      await expect.poll(async () => (await saved(page)).grouping.threads.design).toBe('research');
      await expect(source(page, 'design')).not.toBeVisible();
      await group(page, 'research').getByRole('button', { name: '展开分组：研究', exact: true }).click();

      await group(page, 'client').getByRole('button', { name: '折叠分组：客户端', exact: true }).click();
      await hoverDrag(source(page, '/workspace/remote-ai'), group(page, 'client'));
      await expect(group(page, 'client')).toHaveAttribute('data-chat-drop-active', 'true');
      await expectReadableHighlight(group(page, 'client'));
      await page.screenshot({ path: `${output}/${label}-project-to-group.png`, animations: 'disabled' });
      await page.mouse.up();
      await expect.poll(async () => (await saved(page)).grouping.projects['/workspace/remote-ai']).toBe('client');
      await expect(project(page, '/workspace/remote-ai')).not.toBeVisible();
      await group(page, 'client').getByRole('button', { name: '展开分组：客户端', exact: true }).click();

      // Returning to the same project must remove the individual group override.
      await hoverDrag(source(page, 'design'), project(page, '/workspace/remote-ai'));
      await page.mouse.up();
      const original = page.getByRole('region', { name: 'remote-ai', exact: true });
      await expect(original.getByRole('button', { name: '分组设计讨论', exact: true })).toBeVisible();
      await expect.poll(async () => (await saved(page)).grouping.threads).toEqual({});

      await project(page, '/workspace/research').click();
      await hoverDrag(source(page, 'design'), project(page, '/workspace/research'));
      await expect(project(page, '/workspace/research')).toHaveAttribute('data-chat-drop-active', 'true');
      await expectReadableHighlight(project(page, '/workspace/research'));
      await page.screenshot({ path: `${output}/${label}-thread-to-project.png`, animations: 'disabled' });
      await page.mouse.up();
      await expect.poll(async () => (await saved(page)).preferences.projectOverrides.design).toBe('/workspace/research');
      await expect(source(page, 'design')).not.toBeVisible();
      await project(page, '/workspace/research').click();
      const destination = page.getByRole('region', { name: 'research', exact: true });
      await expect(destination.getByRole('button', { name: '分组设计讨论', exact: true })).toBeVisible();
      expect((await saved(page)).preferences.selected).toBeNull();
      await page.reload();
      await expect(destination.getByRole('button', { name: '分组设计讨论', exact: true })).toBeVisible();
      await expect(original.getByRole('button', { name: '发布检查清单', exact: true })).toBeVisible();
      await page.screenshot({ path: `${output}/${label}-moved.png`, animations: 'disabled' });
    });
  }

  test(`${mode}: Escape and invalid destinations leave placement unchanged; menus remain available`, async ({ page }) => {
    await page.goto(`/e2e/custom-groups-harness.html?mode=${mode}`);
    const before = await saved(page);
    await hoverDrag(source(page, 'design'), group(page, 'research'));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('.chat-sidebar-drag-preview')).toHaveCount(0);
    expect(await saved(page)).toEqual(before);
    await hoverDrag(source(page, '/workspace/remote-ai'), project(page, '/workspace/research'));
    await expect(page.locator('[data-chat-drop-active]')).toHaveCount(0);
    await page.mouse.up();
    expect(await saved(page)).toEqual(before);
    const row = source(page, 'design');
    await row.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '移动到分组' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.click(800, 600);
    const box = await row.boundingBox();
    await row.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true,
      button: 0, clientX: box!.x + 20, clientY: box!.y + 10 });
    await expect(page.getByRole('menuitem', { name: '移动到分组' })).toBeVisible();
    await row.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7 });
    await expect(page.locator('.chat-sidebar-drag-preview')).toHaveCount(0);
  });
}

test('dragging near the sidebar edge scrolls to offscreen destinations', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.goto('/e2e/custom-groups-harness.html?mode=local&scroll');
  const from = source(page, 'design');
  await from.waitFor({ state: 'visible' });
  const area = await from.evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.scrollHeight <= parent.clientHeight || !/auto|scroll/.test(getComputedStyle(parent).overflowY)) continue;
      const box = parent.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.bottom - 12 };
    }
    throw new Error('Missing sidebar scroller');
  });
  const start = await from.boundingBox();
  await page.mouse.move(start!.x + 35, start!.y + 15);
  await page.mouse.down();
  await page.mouse.move(area.x, area.y, { steps: 16 });
  const last = group(page, 'extra-34');
  await expect(last).toBeInViewport();
  const end = await last.boundingBox();
  await page.mouse.move(end!.x + 40, end!.y + 15);
  await expect(last).toHaveAttribute('data-chat-drop-active', 'true');
  await page.mouse.up();
  await expect.poll(async () => (await saved(page)).grouping.threads.design).toBe('extra-34');
});
