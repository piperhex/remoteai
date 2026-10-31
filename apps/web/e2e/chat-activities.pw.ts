import { expect, test } from '@playwright/test';
import type { Thread } from '../src/chat/types';

test('groups adjacent tools, preserves commentary and keeps inspected output current after completion', async ({ page }, info) => {
  const value: Thread = { id: 'activities', cwd: '', preview: '', updatedAt: 1, turns: [{
    id: 'turn', status: 'inProgress', items: [
      { id: 'user', type: 'userMessage', text: '检查操作顺序' },
      { id: 'read', type: 'commandExecution', status: 'completed', command: 'read first', aggregatedOutput: 'FIRST' },
      { id: 'run', type: 'commandExecution', status: 'inProgress', command: 'npm test', aggregatedOutput: 'START' },
      { id: 'done', type: 'commandExecution', status: 'completed', command: 'read last', aggregatedOutput: 'LAST' },
      { id: 'comment', type: 'agentMessage', phase: 'commentary', text: '接着检查页面。' },
      { id: 'other', type: 'commandExecution', status: 'completed', command: 'another command' },
    ],
  }] };
  await page.route('**/display-fixture.json', route => route.fulfill({ json: value }));
  await page.goto('e2e/chat-display-harness.html');
  const group = page.locator('.chat-entry-activities');
  await expect(group).toHaveCount(1);
  await expect(group).toContainText('npm test');
  await expect(group.locator('.is-running')).toHaveCount(1);
  const commentary = page.getByText('接着检查页面。');
  expect((await group.boundingBox())!.y).toBeLessThan((await commentary.boundingBox())!.y);
  await group.getByRole('button').click();
  const sheet = page.locator('.chat-work-drawer');
  if (info.project.name === 'mobile') {
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.chat-inline-tool-content')).toHaveCount(0);
    await expect(sheet.locator('[aria-expanded="false"]')).toHaveCount(3);
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(844);
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.y)).toBe(0);
    await page.screenshot({ path: info.outputPath('mobile-light-activity-collapsed.png') });
  }
  await page.getByRole('button', { name: /执行命令.*npm test/ }).last().click();
  await expect(page.getByText('START', { exact: true })).toBeVisible();
  if (info.project.name === 'mobile') {
    await expect(sheet.locator('.chat-inline-tool-content')).toHaveCount(1);
    await expect(page.locator('.adm-popup-body')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '返回上一层' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('mobile-light-activity-expanded.png') });
  }
  value.turns![0].status = 'completed';
  value.turns![0].items[2] = { ...value.turns![0].items[2], status: 'completed', aggregatedOutput: 'FINISHED' };
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('display-fixture', { detail })), value);
  await expect(page.getByText('FINISHED', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /执行命令.*npm test/ }).last().click();
  await expect(page.getByText('FINISHED', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /执行命令.*read first/ }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: /执行命令.*read last/ }).last()).toBeVisible();
  if (info.project.name === 'mobile') {
    await expect(sheet.locator('.chat-inline-tool-content')).toHaveCount(0);
    await sheet.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '查看处理过程，5 项活动' }).click();
    await expect(sheet.locator('.chat-inline-tool-content')).toHaveCount(0);
  }
});

test('mobile activity drawer scrolls long lists with large text and only mounts opened output', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  await page.setViewportSize({ width: 320, height: 640 });
  const items = Array.from({ length: 24 }, (_, index) => ({ id: `command-${index}`, type: 'commandExecution',
    status: 'completed', command: `check-activity-${index}`, aggregatedOutput: `OUTPUT_${index}\n检查完成` }));
  const value: Thread = { id: 'long-activities', cwd: '', preview: '', updatedAt: 1,
    turns: [{ id: 'turn', status: 'completed', items }] };
  await page.route('**/display-fixture.json', route => route.fulfill({ json: value }));
  await page.goto('e2e/chat-display-harness.html');
  await page.evaluate(async () => {
    const themeModule = '/web/src/theme/preference.ts';
    const { setThemeMode } = await import(themeModule);
    setThemeMode('dark');
    document.documentElement.style.setProperty('--app-font-scale', '1.3');
  });
  await page.getByRole('button', { name: '查看处理过程，24 项活动' }).click();
  const sheet = page.locator('.chat-work-drawer');
  const content = sheet.locator('.adaptive-sheet-content');
  await expect(sheet).toHaveCSS('background-color', 'rgb(27, 32, 30)');
  await expect(sheet.locator('.chat-inline-tool-content')).toHaveCount(0);
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(640);
  await page.screenshot({ path: info.outputPath('mobile-dark-320-font-1.3-list.png') });
  await sheet.getByRole('button', { name: /check-activity-0$/ }).click();
  await expect(sheet.locator('.chat-inline-tool-content')).toHaveCount(1);
  await expect(sheet.locator('.chat-inline-tool-content')).toContainText('OUTPUT_0');
  await expect(sheet).toHaveJSProperty('scrollWidth', 320);
  await page.screenshot({ path: info.outputPath('mobile-dark-320-font-1.3-expanded.png') });
  await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
  expect(await content.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await sheet.getByRole('button', { name: /check-activity-23$/ }).click();
  await expect(sheet.locator('.chat-inline-tool-content')).toHaveCount(2);
  await content.evaluate(node => { node.scrollTop = 0; });
  await expect(sheet.getByRole('button', { name: /check-activity-0$/ })).toHaveAttribute('aria-expanded', 'true');
  await sheet.getByRole('button', { name: /check-activity-0$/ }).click();
  await expect(sheet.getByText('OUTPUT_0', { exact: false })).toHaveCount(0);
});
