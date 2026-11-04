import { expect, test, type Page } from '@playwright/test';
import type { Turn } from '../../../shared/conversation/types';

function fixture() {
  const turn: Turn = { id: 'turn', status: 'completed', items: [
    { id: 'edit', type: 'fileChange', status: 'completed', changes: Array.from({ length: 5 }, (_, i) => ({
      path: `src/file-${i}.ts`, kind: { type: 'update' }, diff: `@@ -1 +1 @@\n-old_${i}\n+new_${i}\n`,
    })) }, { id: 'answer', type: 'agentMessage', text: 'Files updated.' },
  ] };
  return { threadId: 'one', turn };
}
type Fixture = ReturnType<typeof fixture>;
const update = (page: Page, value: Fixture) => page.evaluate(detail =>
  window.dispatchEvent(new CustomEvent('diff-cache-fixture', { detail })), value);

test('keeps expansion, file selection, status and actual diff changes current on cache hits', async ({ page }, info) => {
  const mobile = info.project.name === 'web-mobile';
  const local = info.project.name === 'desktop-local';
  const mode = local ? 'local' : info.project.name === 'desktop-remote' ? 'remote' : 'web';
  const value = fixture();
  await page.addInitScript(() => {
    localStorage.setItem('codex-switch.web.language.v1', 'en');
    localStorage.setItem('codex-switch:language', 'en');
  });
  await page.route('**/diff-cache-fixture.json', route => route.fulfill({ json: value }));
  // Use the application's system-font fallback; this regression must also work offline.
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto(`diff-cache-harness.html?mode=${mode}`);
  const summary = mobile ? page.locator('.chat-files-summary') : page.getByRole('region', { name: 'Changes this turn' });
  await expect(summary).toContainText('src/file-0.ts');
  await page.screenshot({ path: `../../.codex-tmp/task6-${info.project.name}-completed.png` });
  if (!mobile) {
    await summary.getByRole('button', { name: /Show .*2|Show more.*2/i }).click();
    await expect(summary.locator('li')).toHaveCount(5);
  }
  for (let i = 0; i < 20; i++) {
    value.turn.items[1].text = `More text ${i}`;
    await update(page, value);
  }
  await expect(page.getByTestId('answer')).toHaveText('More text 19');
  if (!mobile) await expect(summary.locator('li')).toHaveCount(5);
  await page.screenshot({ path: `../../.codex-tmp/task6-${info.project.name}-text-updates.png` });
  if (mobile) {
    await summary.getByRole('button', { name: 'Review', exact: true }).click();
    await page.locator('.chat-diff-file summary').first().click();
  } else await summary.getByRole('button', {
    name: local ? 'View changes to src/file-0.ts' : 'View diff for src/file-0.ts', exact: true,
  }).click();
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toContainText('new_0');
  value.turn.items[0].changes![0].diff = '@@ -1 +1,2 @@\n-old_0\n+changed_now\n+extra\n';
  await update(page, value);
  await expect(dialog).toContainText('changed_now');
  await expect(dialog).toContainText('extra');
  await page.screenshot({ path: `../../.codex-tmp/task6-${info.project.name}-changed-diff.png` });
  value.threadId = 'two';
  value.turn = { id: 'turn', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: 'Other thread' }] };
  await update(page, value);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(summary).toHaveCount(0);
  const restored = fixture();
  restored.turn.items[0].status = 'inProgress';
  await update(page, restored);
  await expect(summary).toHaveCount(0);
  restored.turn.items[0].status = 'completed';
  await update(page, restored);
  await expect(summary).toContainText('src/file-0.ts');
  restored.turn.status = 'inProgress';
  await update(page, restored);
  await expect(local ? page.getByTestId('local-running').getByRole('button')
    : page.locator('.chat-changes-pill')).toBeVisible();
  await page.screenshot({ path: `../../.codex-tmp/task6-${info.project.name}-running.png` });
});
