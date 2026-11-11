import { expect, test, type Locator } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBackend, nativeShell } from './cli-gui-support';

const evidence = resolve('../../.codex-tmp/cli-ui-parity-evidence');
const style = (node: HTMLElement) => {
  const css = getComputedStyle(node);
  const bounds = node.getBoundingClientRect();
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    fontSize: css.fontSize, lineHeight: css.lineHeight, fontFamily: css.fontFamily,
    padding: css.padding, radius: css.borderRadius, background: css.backgroundColor, color: css.color };
};
async function anatomy(root: Locator, input: Locator, selector: Locator) {
  const frame = input.locator('xpath=ancestor::*[contains(@class,"composer_") or contains(concat(" ",@class," ")," chat-composer ")][1]');
  const send = root.getByRole('button', { name: '发送消息', exact: true });
  const model = root.locator('button:visible').filter({ hasText: 'GPT-6' }).last();
  return { input: await input.evaluate(style), frame: await frame.evaluate(style),
    send: await send.evaluate(style), model: await model.evaluate(style), version: await selector.evaluate(style),
    controls: await frame.locator('button').evaluateAll(nodes => nodes.map(node => ({
      label: node.getAttribute('aria-label') || node.textContent, disabled: node.disabled,
    }))) };
}
async function settle(root: Locator) {
  await root.evaluate(async node => {
    const animations = node.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
  });
}
for (const mode of ['local', 'remote', 'web']) {
  for (const large of [false, true]) {
    test(`${mode}: Codex and external CLI visual anatomy ${large ? 'large dark narrow' : 'default'}`, async ({ page }) => {
      await mkdir(evidence, { recursive: true });
      await page.setViewportSize(large ? { width: 960, height: 900 } : { width: 1440, height: 980 });
      if (mode === 'local') await nativeShell(page);
      await localBackend(page);
      await page.goto(`/e2e/cli-gui-harness.html?mode=${mode}&native${large ? '&large&dark' : ''}`);
      const measurements: Record<string, Awaited<ReturnType<typeof anatomy>>> = {};
      const selector = page.locator('.cli-gui-engine:visible');
      for (const engine of ['Codex GUI', 'Claude GUI', 'Gemini GUI']) {
        if (engine !== 'Codex GUI') {
          await selector.click(); await page.getByRole('menuitem', { name: engine, exact: true }).click();
        }
        await expect(selector).toContainText(engine);
        const root = engine === 'Codex GUI' ? page.locator('.cli-gui-codex-content:visible')
          : page.locator('.cli-gui-pane');
        const input = root.locator('[contenteditable=true]:visible, textarea:visible').first();
        await expect(input).toBeVisible();
        await root.locator('[data-project-bar] button[aria-haspopup="menu"]').first().click();
        await page.getByRole('menuitemradio', { name: 'Remote AI', exact: true }).click();
        await expect(root.locator('button:visible').filter({ hasText: 'GPT-6' }).last()).toBeVisible();
        await settle(root);
        measurements[engine] = await anatomy(root, input, selector);
        if (engine !== 'Codex GUI') {
          const baseline = measurements['Codex GUI'];
          for (const part of ['input', 'frame', 'send', 'model'] as const) {
            expect(measurements[engine][part], `${mode} ${engine} ${part}`).toEqual(baseline[part]);
          }
          const { width: _baselineNameWidth, ...baselineVersion } = baseline.version;
          const { width: _engineNameWidth, ...engineVersion } = measurements[engine].version;
          expect(engineVersion).toEqual(baselineVersion);
          const labels = (value: typeof baseline) => value.controls.map(control =>
            control.label?.startsWith('访问权限：') ? '访问权限' : control.label);
          expect(labels(measurements[engine])).toEqual(labels(baseline));
        }
        const label = `${mode}-${large ? 'dark-narrow-large' : 'light-default'}-${engine.split(' ')[0].toLowerCase()}`;
        await page.screenshot({ path: resolve(evidence, `${label}-empty.png`), animations: 'disabled' });
        await input.fill('请检查当前项目。\n整理需要调整的界面。');
        await expect(root.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
        await settle(root);
        measurements[`${engine}:draft`] = await anatomy(root, input, selector);
        if (engine !== 'Codex GUI') {
          for (const part of ['input', 'frame', 'send', 'model'] as const) {
            expect(measurements[`${engine}:draft`][part]).toEqual(measurements['Codex GUI:draft'][part]);
          }
        }
        await page.screenshot({ path: resolve(evidence, `${label}-draft.png`), animations: 'disabled' });
        await input.fill(Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行项目检查说明`).join('\n'));
        await settle(root);
        measurements[`${engine}:multiline`] = await anatomy(root, input, selector);
        if (engine !== 'Codex GUI') {
          expect(measurements[`${engine}:multiline`].frame).toEqual(measurements['Codex GUI:multiline'].frame);
        }
        await page.screenshot({ path: resolve(evidence, `${label}-multiline.png`), animations: 'disabled' });
        await input.fill('');
      }
      await writeFile(resolve(evidence, `${mode}-${large ? 'large' : 'default'}-anatomy.json`),
        JSON.stringify(measurements, null, 2));
    });
  }
}
