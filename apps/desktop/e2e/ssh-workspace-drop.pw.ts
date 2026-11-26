import { expect, test, type Page } from '@playwright/test';
import { sshEditorFixture } from './ssh-editor-fixture';

async function trackDragListeners(page: Page, web: boolean) {
  return page.evaluateHandle(web => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: {
      metadata: object; invoke: (command: string, args: { event?: string }) => Promise<unknown>;
    } }).__TAURI_INTERNALS__;
    bridge.metadata = { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } };
    const calls: string[] = [];
    const invoke = bridge.invoke;
    bridge.invoke = async (command, args) => {
      if (command === 'plugin:event|listen' && args.event?.startsWith('tauri://drag-')) {
        calls.push(args.event);
        if (web) throw new Error('Command plugin:event|listen not allowed by ACL');
      }
      return invoke(command, args);
    };
    return calls;
  }, web);
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode} SSH workspace selects the file drop interface of the displaying app`, async ({ page }, info) => {
    // A website inside a Tauri webview can see the marker even when it has no native permissions.
    await page.addInitScript(() => Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {} }));
    const fixture = await sshEditorFixture(page);
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto(`/e2e/ssh-harness.html?workspace&cloud=1&mode=${mode}`);
    await page.locator('.sidebar-tabs').getByRole('button', { name: 'SSH', exact: true }).click();
    const workspace = page.getByRole('region', { name: 'SSH', exact: true });
    const listeners = await trackDragListeners(page, mode === 'web');
    await workspace.locator('.ssh-profile-card').filter({ hasText: 'Editor server' }).click();
    await page.getByRole('menuitem', { name: mode === 'local' ? /Studio PC/ : /Workstation/ }).click();
    await expect(workspace.getByRole('treeitem', { name: 'hello.txt', exact: true })).toBeVisible();
    await expect(workspace.locator('.xterm:visible')).toBeVisible();
    await expect(workspace.getByText('Command plugin:event|listen not allowed by ACL')).toHaveCount(0);
    if (mode === 'web') {
      expect(await listeners.jsonValue()).toEqual([]);
      const data = await page.evaluateHandle(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['browser drop'], 'uploaded.txt'));
        return transfer;
      });
      await workspace.locator('.ssh-project-browser').dispatchEvent('drop', { dataTransfer: data });
      await data.dispose();
      await expect(workspace.getByRole('treeitem', { name: 'uploaded.txt', exact: true })).toBeVisible();
      expect(fixture.files.get('/uploaded.txt')?.toString()).toBe('browser drop');
    } else {
      expect(await listeners.jsonValue()).toContain('tauri://drag-drop');
    }
    await page.screenshot({ path: info.outputPath(`ssh-files-${mode}.png`), animations: 'disabled' });
  });
}

test('embedded mobile Web chat opens SSH files without native listeners', async ({ page }, info) => {
  await page.addInitScript(() => Object.assign(window, { isTauri: true, __TAURI_INTERNALS__: {} }));
  await sshEditorFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/ssh-harness.html?cloud=1&mode=web');
  await page.getByRole('button', { name: '打开远程终端', exact: true }).click();
  const listeners = await trackDragListeners(page, true);
  await page.getByRole('button', { name: '终端连接选项' }).click();
  await page.getByRole('menuitem', { name: 'Editor server', exact: true }).click();
  await page.getByRole('button', { name: '远程文件浏览', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'hello.txt', exact: true })).toBeVisible();
  expect(await listeners.jsonValue()).toEqual([]);
  await page.screenshot({ path: info.outputPath('ssh-files-mobile-web.png'), animations: 'disabled' });
});
