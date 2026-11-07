import { expect, test, type Page } from '@playwright/test';
import type { Conversation } from '../../../shared/conversation/types';

const sources = ['C:/captures/first.png', 'C:/captures/second.png', 'C:/captures/third.png'];
const fixture: Conversation = {
  thread: { id: 'image-navigation', cwd: '', preview: '', updatedAt: 1 },
  activeTurn: null, tokens: 0, error: '', turns: [{ id: 'turn', status: 'completed', items: [
    { id: 'user', type: 'userMessage', status: 'completed', content: [
      { type: 'text', text: '请检查这些图片。' }, { type: 'localImage', path: sources[0] },
    ] },
    { id: 'reply', type: 'agentMessage', status: 'completed',
      text: `![图片二](${sources[1]})\n\n![图片三](${sources[2]})` },
  ] }],
};

async function setup(page: Page, mode: string, value = fixture, open = true) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  const images = await page.evaluate(() => ['#164f49', '#1b4561', '#55417d'].map((color, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 920; canvas.height = 520;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff18'; context.fillRect(48, 48, 824, 424);
    context.fillStyle = '#fff'; context.font = '32px sans-serif';
    context.fillText(`Image ${index + 1} / 3`, 90, 140);
    context.font = '20px sans-serif'; context.fillText('Remote AI · Image preview', 90, 182);
    context.fillStyle = '#ffffff38';
    context.fillRect(90, 230, 350, 190); context.fillRect(480, 230, 350, 190);
    return canvas.toDataURL();
  }));
  const requests: string[] = [];
  await page.route('**/history-fixture.json', route => route.fulfill({ json: value }));
  await page.route('**/image-preview.json', route => {
    const request = route.request().postDataJSON();
    requests.push(request.source);
    return route.fulfill({ json: { url: images[sources.indexOf(request.source)] } });
  });
  await page.route('**/__codex_switch__/api/invoke', route => {
    const request = route.request().postDataJSON().args.request;
    expect(request.operation).toBe('imagePreview');
    requests.push(request.source);
    return route.fulfill({ json: { ok: true, result: { data: { url: images[sources.indexOf(request.source)] } } } });
  });
  await page.goto(`/e2e/image-history-harness.html?mode=${mode}&editor`);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('保留消息草稿');
  if (open) await page.getByRole('button', { name: '放大查看：图片三', exact: true }).click();
  return { images, requests };
}

for (const mode of ['local', 'remote', 'web']) {
  for (const enlarged of [false, true]) {
    const state = enlarged ? 'dark-narrow-font24' : 'light-wide-font14';
    test(`${mode}: image navigation ${state}`, async ({ page }, info) => {
      const width = enlarged ? 800 : 1440;
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(fontSize => localStorage.setItem('codex-switch:global-font-size', String(fontSize)),
        enlarged ? 24 : 14);
      const { images } = await setup(page, mode);
      if (enlarged) {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Theme', exact: true }).click();
        await page.getByRole('button', { name: '放大查看：图片三', exact: true }).click();
      }
      const image = page.locator('.cs-image-stage img');
      const previous = page.locator('.cs-image-previous');
      const next = page.locator('.cs-image-next');
      await expect(image).toHaveAttribute('src', images[2]);
      await expect(next).toBeDisabled();
      await page.keyboard.press('ArrowRight');
      await expect(image).toHaveAttribute('src', images[2]);
      for (const button of [previous, next]) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.y + bounds.height / 2).toBe(450);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await page.screenshot({ path: info.outputPath(`${mode}-${state}-last.png`) });
      await previous.click();
      await expect(image).toHaveAttribute('src', images[1]);
      await expect(previous).toBeEnabled();
      await expect(next).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`${mode}-${state}-middle.png`) });
      await page.getByRole('button', { name: '放大图片', exact: true }).click();
      await page.getByRole('button', { name: '旋转图片', exact: true }).click();
      await page.keyboard.press('ArrowLeft');
      await expect(image).toHaveAttribute('src', images[0]);
      await expect(previous).toBeDisabled();
      await expect(page.getByRole('button', { name: '还原图片', exact: true })).toHaveText('100%');
      await expect(image).toHaveAttribute('style', /rotate\(0deg\) scale\(1\)/);
      await page.keyboard.press('ArrowLeft');
      await expect(image).toHaveAttribute('src', images[0]);
      await page.screenshot({ path: info.outputPath(`${mode}-${state}-first.png`) });
      await next.click();
      await expect(image).toHaveAttribute('src', images[1]);
      await page.getByRole('button', { name: '调整大小', exact: true }).click();
      const input = page.getByLabel('宽度（像素）');
      await input.fill('1200');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowRight');
      await expect(input).toHaveValue('1200');
      await expect(image).toHaveAttribute('src', images[1]);
      await page.locator('.cs-image-ai-form textarea').fill('保留编辑内容');
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('.cs-image-ai-form textarea')).toHaveValue('保留编辑内容');
      await expect(image).toHaveAttribute('src', images[1]);
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await page.keyboard.press('ArrowRight');
      await expect(image).toHaveAttribute('src', images[2]);
      await page.keyboard.press('Escape');
      await expect(page.locator('.cs-image-viewer')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('保留消息草稿');
    });
  }

  test(`${mode}: switches to an image outside the rendered history without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const value = structuredClone(fixture);
    value.turns[0].items = [fixture.turns[0].items[0],
      ...Array.from({ length: 80 }, (_, index) => ({ id: `text-${index}`, type: 'agentMessage',
        phase: 'commentary' as const, status: 'completed', text: `历史消息 ${index}。\n\n保留原来的阅读位置。` })),
      { id: 'last-image', type: 'agentMessage', status: 'completed', text: `![图片三](${sources[2]})` }];
    const { images, requests } = await setup(page, mode, value, false);
    await expect(page.locator('[data-message-id="user"] img')).toHaveCount(0);
    await page.getByRole('button', { name: '放大查看：图片三', exact: true }).click();
    const viewport = mode === 'local' ? page.getByLabel('对话消息') : page.locator('.chat-messages');
    const offset = await viewport.evaluate(node => node.scrollTop);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.cs-image-stage img')).toHaveAttribute('src', images[0]);
    expect(requests).toContain(sources[0]);
    await expect(page.locator('.cs-image-previous')).toBeDisabled();
    expect(await viewport.evaluate(node => node.scrollTop)).toBe(offset);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.cs-image-stage img')).toHaveAttribute('src', images[2]);
  });
}
