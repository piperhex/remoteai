import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import type { Conversation } from '../../../shared/conversation/types';

type Mode = 'local' | 'remote' | 'web';
const modes: Mode[] = ['local', 'remote', 'web'];
const sources = ['wide', 'tall'].map(name => `C:/captures/${name}.png`);
const fixture: Conversation = {
  thread: { id: 'image-placeholders', cwd: '', preview: '', updatedAt: 1 },
  activeTurn: null, tokens: 0, error: '', turns: [{ id: 'turn', status: 'completed', items: [
    { id: 'user', type: 'userMessage', content: [
      { type: 'text', text: '请检查这两张图片。' }, ...sources.map(path => ({ type: 'localImage', path })),
    ] },
    { id: 'answer', type: 'agentMessage', phase: 'final_answer',
      text: '图片预览\n\n![横图](/C:/captures/wide.png)\n\n![长图](/C:/captures/tall.png)\n\n可以点击查看原图。' },
  ] }],
};

async function setup(page: Page) {
  const pending: Route[] = [];
  let paused = true;
  const images = await page.evaluate(() => [false, true].map(tall => {
    const canvas = document.createElement('canvas');
    canvas.width = tall ? 180 : 640;
    canvas.height = tall ? 640 : 180;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#eaf3ed'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#168348'; context.fillRect(16, 16, canvas.width - 32, 60);
    context.fillStyle = '#fff'; context.font = '20px sans-serif'; context.fillText('Codex GUI', 24, 54);
    return canvas.toDataURL();
  }));
  async function respond(route: Route) {
    const body = route.request().postDataJSON();
    const local = Boolean(body.args);
    const source = local ? body.args.request.source : body.source;
    const url = images[source.includes('tall') ? 1 : 0];
    await route.fulfill({ json: local ? { ok: true, result: { data: { url } } } : { url } });
  }
  const capture = async (route: Route) => { if (paused) pending.push(route); else await respond(route); };
  await page.route('**/history-fixture.json', route => route.fulfill({ json: fixture }));
  await page.route('**/image-preview.json', capture);
  await page.route('**/__codex_switch__/api/invoke', capture);
  return async () => {
    await expect.poll(() => pending.length).toBeGreaterThanOrEqual(2);
    paused = false;
    await Promise.all(pending.splice(0).map(respond));
  };
}

async function dimensions(slots: Locator) {
  return slots.evaluateAll(nodes => nodes.map(node => {
    const bounds = node.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
  }));
}

for (const mode of modes) {
  for (const width of [900, 1280]) {
    test(`${mode} ${width}: pending, decoded and failed images keep the composer thumbnail size`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const release = await setup(page);
      await page.goto(`/e2e/image-history-harness.html?mode=${mode}`);
      const slots = page.locator('span[data-viewport-content]');
      await expect(slots).toHaveCount(4);
      await expect(slots.locator('[role="status"]')).toHaveCount(4);
      const before = await dimensions(slots);
      expect(before.every(size => size.width === 120 && size.height === 120)).toBe(true);
      const viewport = mode === 'local' ? page.getByLabel('对话消息') : page.locator('.chat-messages');
      const scroll = await viewport.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight }));
      const prefix = `../../.codex-tmp/image-placeholders/${mode}-${width}`;
      await page.screenshot({ path: `${prefix}-loading-light.png` });
      await release();
      await expect(slots.locator('button[aria-busy="false"]')).toHaveCount(4);
      expect(await dimensions(slots)).toEqual(before);
      expect(await viewport.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight }))).toEqual(scroll);
      await page.screenshot({ path: `${prefix}-loaded-light.png` });
      await slots.locator('img').evaluateAll(images => images.forEach(image => image.dispatchEvent(new Event('error'))));
      await expect(slots.getByText('图片加载失败', { exact: true })).toHaveCount(4);
      expect(await dimensions(slots)).toEqual(before);
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await page.screenshot({ path: `${prefix}-failed-dark.png` });
      for (const slot of await slots.all()) await slot.getByRole('button', { name: '重试', exact: true }).click();
      await expect(slots.locator('button[aria-busy="false"]')).toHaveCount(4);
      expect(await dimensions(slots)).toEqual(before);
      await page.screenshot({ path: `${prefix}-loaded-dark.png` });
      await slots.locator('button[aria-busy="false"]').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: '关闭图片', exact: true }).click();
      expect(await dimensions(slots)).toEqual(before);
    });
  }
}
