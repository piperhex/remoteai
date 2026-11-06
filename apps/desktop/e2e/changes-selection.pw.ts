import { expect, test, type Page } from '@playwright/test';
import type { Thread, Turn } from '../../../shared/conversation/types';

const old: Turn = { id: 'old', status: 'completed', items: [],
  diff: 'diff --git a/old.ts b/old.ts\n--- a/old.ts\n+++ b/old.ts\n@@ -1 +1 @@\n-old\n+older\n' };
const latest: Turn = { id: 'latest', status: 'completed', items: [
  { id: 'question', type: 'userMessage', content: [{ type: 'text', text: 'Add the latest file.' }] },
  { id: 'edit', type: 'fileChange', status: 'completed',
    changes: [{ path: 'new.ts', kind: { type: 'add' }, diff: 'export const latest = true;\n' }] },
  { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Latest file added.' },
] };
const source = (turns: Turn[]): Thread => ({ id: 'changes', cwd: '', preview: '', updatedAt: 0, turns });
// Serialized summarizeProcesses output; the component regression also checks the real reducer.
const foldedLatest: Turn = { ...latest, items: [latest.items[0], {
  id: 'edit', type: 'processSummary', activityCount: 1,
  processRef: { threadId: 'changes', turnId: 'latest', itemId: 'edit', endItemId: 'edit' },
  processOutputs: [latest.items[1]],
}, latest.items[2]] };

async function expectLatestFiles(page: Page) {
  const drawer = page.locator('[data-details-panel]');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('new.ts');
  await expect(drawer).toContainText('export const latest = true;');
  await expect(drawer).not.toContainText('old.ts');
}

for (const withOld of [false, true]) {
  test(`latest files survive folded reload, older diff: ${withOld}`, async ({ page }, info) => {
    const mode = info.project.name === 'desktop-local' ? 'local'
      : info.project.name === 'desktop-remote' ? 'remote' : 'web';
    const turns = [...(withOld ? [old] : []), latest];
    if (withOld) await page.setViewportSize({ width: 960, height: 900 });
    let thread = source(turns);
    await page.addInitScript(() => {
      localStorage.setItem('codex-switch.web.language.v1', 'en');
      localStorage.setItem('codex-switch:language', 'en');
    });
    await page.route('**/changes-selection.json', route => route.fulfill({ json: thread }));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }));
    const open = page.getByRole('button', { name: 'View file changes', exact: true });
    const drawer = page.locator('[data-details-panel]');
    const evidence = `../../.codex-tmp/changes-selection-evidence/${info.project.name}-${withOld ? 'old-and-new' : 'new-only'}`;
    await page.goto(`changes-selection-harness.html?mode=${mode}${withOld ? '&dark' : ''}`);
    await expect(page.getByText('Latest file added.', { exact: true })).toBeVisible();
    await open.click();
    await expectLatestFiles(page);
    await page.screenshot({ path: `${evidence}-before-reload.png`, animations: 'disabled' });
    thread = source([...(withOld ? [old] : []), foldedLatest]);
    expect(thread.turns!.at(-1)!.items.some(item => item.type === 'fileChange')).toBe(false);
    await page.reload();
    await expect(page.getByText('Latest file added.', { exact: true })).toBeVisible();
    if (!await drawer.isVisible()) await open.click();
    await expectLatestFiles(page);
    await page.screenshot({ path: `${evidence}-after-reload.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'Close details panel', exact: true }).click();
    await expect(drawer).toBeHidden();
    await open.click();
    await expect(drawer).toContainText('new.ts');
  });
}
