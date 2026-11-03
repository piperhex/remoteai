import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { testText } from '../../../scripts/i18n-fixture.mjs';

async function nativeFolderBridge(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI_INTERNALS__: {
      transformCallback: () => 1, unregisterCallback: () => {},
      invoke: async (command: string, args?: { request?: object }) => {
        if (command !== 'codex_gui_file_action') return 1;
        const response = await fetch('/web/thread-action', { method: 'POST',
          body: JSON.stringify({ operation: 'guiFileAction', ...args?.request }) });
        return response.json();
      },
    } });
  });
}

async function setup(page: Page, mode: string, options: {
  failPin?: boolean; sidebarPathsOnly?: boolean; failDirectories?: boolean;
} = {}) {
  let { failPin = false } = options;
  let { failDirectories = false } = options;
  if (mode === 'local') await nativeFolderBridge(page);
  const calls: { operation: string; cwd?: string; pinned?: boolean; threadId?: string; name?: string;
    directory?: string; includeFiles?: boolean;
    target?: { path?: string; threadId?: string | null }; action?: { type: string; application?: string } }[] = [];
  const threads = [{ id: 'one', name: '项目对话', cwd: '/project', preview: '', updatedAt: 1 },
    { id: 'two', name: '其他项目对话', cwd: '/other', preview: '', updatedAt: 2 }];
  let revision = 0;
  let pinnedProjects: string[] = [];
  let pins: string[] = [];
  const sidebar = () => ({ revision: ++revision, pinnedProjects, pins, readState: {},
    threads: Object.fromEntries(threads.map(thread => [thread.id,
      { cwd: thread.cwd, projectName: thread.cwd.split('/').at(-1), title: thread.name, running: false }])) });
  await page.route('**/thread-action', async route => {
    const input = route.request().postDataJSON() as typeof calls[number]; calls.push(input);
    if (failPin && input.operation === 'guiProjectPin') {
      failPin = false;
      return route.fulfill({ status: 500, json: {} });
    }
    if (input.operation === 'list') return route.fulfill({ json: {
      data: options.sidebarPathsOnly ? threads.map(thread => ({ ...thread, cwd: '' })) : threads,
      nextCursor: null, sidebar: sidebar(),
    } });
    if (input.operation === 'guiFileAction') return route.fulfill({ json: { path: input.target?.path, saved: false } });
    if (input.operation === 'projectDirectories') {
      const directory = input.directory ?? '';
      if (directory && failDirectories) {
        failDirectories = false;
        return route.fulfill({ status: 500, json: {} });
      }
      const entries = directory === '/project'
        ? [{ name: 'src', path: '/project/src', directory: true },
          { name: 'README.md', path: '/project/README.md', directory: false, size: 2048 }]
        : directory === '/project/src'
          ? [{ name: 'index.ts', path: '/project/src/index.ts', directory: false, size: 1024 }]
          : [{ name: 'project', path: '/project', directory: true }];
      return route.fulfill({ json: { directory, parent: directory === '/project/src' ? '/project' : null,
        entries, truncated: false } });
    }
    if (input.operation === 'guiProjectPin') pinnedProjects = input.pinned ? [input.cwd!] : [];
    if (input.operation === 'guiProjectRemove') {
      pinnedProjects = [];
      threads.forEach(thread => { if (thread.cwd === input.cwd) thread.cwd = ''; });
    }
    if (input.operation === 'threadPin') pins = input.pinned ? [input.threadId!] : [];
    if (input.operation === 'forkLatest') {
      const fork = { ...threads[0], id: 'fork', name: '新的分支' }; threads.push(fork);
      return route.fulfill({ json: { thread: fork } });
    }
    return route.fulfill({ json: sidebar() });
  });
  await page.goto(`./e2e/thread-actions-harness.html?sidebar=${mode}`);
  await expect(page.getByRole('button', { name: '项目对话', exact: true })).toBeVisible();
  return calls;
}

async function openProjectMenuItem(page: Page, calls: unknown[], label: string, mode: string) {
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await expect(page.getByRole('menu')).toBeHidden();
  if (mode === 'local') {
    await expect.poll(() => calls.at(-1)).toEqual({ operation: 'guiFileAction',
      target: { path: '/project', threadId: null }, action: { type: 'open', application: 'default' } });
    return;
  }
  await expect(page.getByRole('dialog', { name: '浏览项目文件' })).toBeVisible();
  await expect(page.getByRole('option', { name: /README.md/ })).toBeVisible();
  await expect(page.locator('.pe-footer input')).toHaveValue('/project');
  await expect(page.locator('.pe-footer .pe-primary')).toHaveCount(0);
  expect(calls).toContainEqual({ operation: 'projectDirectories', directory: '/project', includeFiles: true });
  expect(calls).not.toContainEqual(expect.objectContaining({ operation: 'guiFileAction' }));
  await page.screenshot({ path: `../../.codex-tmp/project-folder-preview/${mode}-browse.png` });
  await page.locator('.pe-footer').getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function longPressContext(target: Locator) {
  await target.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true,
    button: 0, clientX: 80, clientY: 200 });
  await expect(target.page().getByRole('menu')).toBeVisible();
  await target.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
}

async function longPressProject(page: Page) {
  const heading = page.locator('section[aria-label="project"] .chat-project-toggle');
  // Raw CDP touch input needs the drawer animation to settle before measuring its target.
  await heading.click({ trial: true });
  const bounds = (await heading.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart',
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] });
    await expect(page.getByRole('heading', { name: '管理项目：project', exact: true })).toBeVisible();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

test('mobile project long press pins, unpins and confirms removal while preserving chats', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile project actions');
  const calls = await setup(page, 'web');
  const project = page.locator('section[aria-label="project"]');
  const heading = project.locator('.chat-project-toggle');
  await longPressProject(page);
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('selected')).toHaveText('none');
  expect((await page.locator('.chat-thread-actions').boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: '../../.codex-tmp/project-actions-mobile.png' });
  await page.getByRole('button', { name: '置顶', exact: true }).click();
  await expect(project.getByLabel('已置顶', { exact: true })).toBeVisible();
  await longPressProject(page);
  await page.getByRole('button', { name: '取消置顶', exact: true }).click();
  await expect(project.getByLabel('已置顶', { exact: true })).toHaveCount(0);
  await heading.click();
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await longPressProject(page);
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '移除项目', exact: true }).click();
  await expect(page.getByText('移除这个项目？', { exact: true })).toBeVisible();
  await expect(page.getByText('项目将从列表中移除，对话会保留在“最近”中。电脑上的文件不会删除。')).toBeVisible();
  expect(calls.filter(call => call.operation === 'guiProjectRemove')).toHaveLength(0);
  await page.screenshot({ path: '../../.codex-tmp/project-remove-mobile.png' });
  await page.getByRole('button', { name: '返回上一层', exact: true }).click();
  await expect(page.getByRole('button', { name: '置顶', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移除项目', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(project).toBeVisible();
  await longPressProject(page);
  await page.getByRole('button', { name: '移除项目', exact: true }).click();
  await page.getByRole('button', { name: '移除项目', exact: true }).click();
  await expect(project).toHaveCount(0);
  await expect(page.locator('section[aria-label="最近"]').getByRole('button', { name: '项目对话', exact: true }))
    .toBeVisible();
  await expect(page.getByRole('button', { name: '其他项目对话', exact: true })).toBeVisible();
  expect(calls.filter(call => call.operation === 'guiProjectRemove'))
    .toEqual([{ operation: 'guiProjectRemove', cwd: '/project' }]);
  expect(calls.some(call => call.operation === 'delete')).toBe(false);
  const recent = page.locator('section[aria-label="最近"] .chat-project-toggle');
  await recent.dispatchEvent('pointerdown', { isPrimary: true, button: 0, pointerType: 'touch' });
  await page.waitForTimeout(600);
  await recent.dispatchEvent('pointerup', { isPrimary: true, pointerType: 'touch' });
  await expect(page.locator('.chat-thread-actions')).toHaveCount(0);
});

test('mobile project gestures cancel on movement and failed actions can be retried', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile project actions');
  const calls = await setup(page, 'web', { failPin: true });
  const heading = page.locator('section[aria-label="project"] .chat-project-toggle');
  await heading.dispatchEvent('pointerdown', { isPrimary: true, button: 0, clientX: 40, clientY: 80 });
  await heading.dispatchEvent('pointermove', { isPrimary: true, clientX: 40, clientY: 120 });
  await page.waitForTimeout(600);
  await heading.dispatchEvent('pointerup', { isPrimary: true });
  await expect(page.locator('.chat-thread-actions')).toHaveCount(0);
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
  await longPressProject(page);
  await page.getByRole('button', { name: '置顶', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('操作未完成，请稍后重试。');
  await page.getByRole('button', { name: '置顶', exact: true }).click();
  await expect(page.locator('.chat-thread-actions')).toHaveCount(0);
  expect(calls.filter(call => call.operation === 'guiProjectPin')).toHaveLength(2);
});

test('mobile project actions switch released languages without losing the open menu', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile project actions');
  await setup(page, 'web');
  await longPressProject(page);
  const modulePath = fileURLToPath(new URL('../../../shared/localization/interfaceLanguage.ts', import.meta.url))
    .replaceAll('\\', '/');
  for (const language of ['en', 'ru', 'ja', 'zh'] as const) {
    await page.evaluate(async ({ url, language }) => {
      const { setInterfaceLanguage } = await import(url);
      setInterfaceLanguage(language);
    }, { url: `/web/@fs/${modulePath}`, language });
    await expect(page.getByRole('heading', { name: testText('client.conversation.manageProject',
      { value1: 'project' }, language), exact: true })).toBeVisible();
    const remove = testText('client.conversation.removeProject', {}, language);
    await page.getByRole('button', { name: remove, exact: true }).click();
    await expect(page.getByText(testText('client.projectActions.removeDescription', {}, language))).toBeVisible();
    expect((await page.locator('.chat-thread-actions').boundingBox())!.width).toBeLessThanOrEqual(400);
    await page.getByRole('button', { name: testText('client.app.goBackOneLevel', {}, language), exact: true }).click();
  }
});

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode} project and thread context menus match and preserve conversations`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop sidebar menus');
    const calls = await setup(page, mode);
    const project = page.locator('section[aria-label="project"]');
    const heading = project.locator('button[aria-expanded]').first();
    await heading.click({ button: 'right' });
    const openInExplorer = testText('client.projectBrowser.openInExplorer', {}, 'zh');
    const pin = testText('client.conversation.pin', {}, 'zh');
    const removeProject = testText('client.conversation.removeProject', {}, 'zh');
    await expect(page.getByRole('menuitem')).toHaveText([pin, openInExplorer, '移动到分组', removeProject]);
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect((await page.getByRole('menu').boundingBox())!.width).toBeLessThanOrEqual(400);
    await page.screenshot({ path: `../../.codex-tmp/project-menu-${mode}.png` });
    await openProjectMenuItem(page, calls, openInExplorer, mode);
    await longPressContext(heading);
    await expect(page.getByRole('menuitem')).toHaveText([pin, openInExplorer, '移动到分组', removeProject]);
    await page.getByRole('menuitem', { name: pin, exact: true }).click();
    await expect(project.getByLabel('已置顶', { exact: true })).toBeVisible();
    if (mode === 'web') await heading.click({ button: 'right' });
    else await page.getByRole('button', { name: '管理项目：project', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: '取消置顶', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: '取消置顶', exact: true }).click();
    await expect(project.getByLabel('已置顶', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '项目对话', exact: true }).click({ button: 'right' });
    const threadMenu = [pin, openInExplorer, '重命名', '创建分支', '归档', '删除', '移动到分组'];
    await expect(page.getByRole('menuitem')).toHaveText(threadMenu);
    await expect(page.getByTestId('selected')).toHaveText('none');
    await page.screenshot({ path: `../../.codex-tmp/thread-menu-${mode}.png` });
    await openProjectMenuItem(page, calls, openInExplorer, mode);
    await longPressContext(page.getByRole('button', { name: '项目对话', exact: true }));
    await expect(page.getByRole('menuitem')).toHaveText(threadMenu);
    await openProjectMenuItem(page, calls, openInExplorer, mode);
    await page.keyboard.press('Escape');
    await heading.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: '移除项目', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: '移除项目', exact: true }).click();
    await expect(project).toHaveCount(0);
    await expect(page.locator('section[aria-label="最近"]').getByRole('button', { name: '项目对话' })).toBeVisible();
    await expect(page.getByRole('button', { name: '其他项目对话', exact: true })).toBeVisible();
    expect(calls.some(call => call.operation === 'delete')).toBe(false);
    if (mode !== 'local') expect(calls.filter(call => call.operation === 'guiProjectRemove'))
      .toEqual([{ operation: 'guiProjectRemove', cwd: '/project' }]);
  });
}

test('web thread menu opens the project path supplied by the sidebar snapshot', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop sidebar menus');
  const calls = await setup(page, 'web', { sidebarPathsOnly: true });
  const project = page.locator('section[aria-label="project"]');
  await project.locator('.chat-thread').first().click({ button: 'right' });
  await openProjectMenuItem(page, calls, testText('client.projectBrowser.openInExplorer', {}, 'zh'), 'web');
  await expect(page.getByTestId('selected')).toHaveText('none');
});

for (const mode of ['remote', 'web']) {
  test(`${mode} browses folders and retries failures without changing the current chat`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop folder browser');
    await page.setViewportSize({ width: 1024, height: 768 });
    const calls = await setup(page, mode, { failDirectories: true });
    await page.getByRole('button', { name: '其他项目对话', exact: true }).click();
    await expect(page.getByTestId('selected')).toHaveText('two');
    await page.getByRole('button', { name: '项目对话', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: testText('client.projectBrowser.openInExplorer', {}, 'zh') }).click();
    await expect(page.getByRole('alert')).toHaveText(testText('client.projectExplorer.loadError', {}, 'zh'));
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.screenshot({ path: `../../.codex-tmp/project-folder-preview/${mode}-error.png`, animations: 'disabled' });
    await page.locator('.pe-empty').getByRole('button').click();
    await expect(page.getByRole('option', { name: /README.md/ })).toBeVisible();
    await page.getByRole('searchbox').fill('README');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('searchbox').fill('');
    await page.locator('.pe-entry[data-path="/project/src"]').dblclick();
    await expect(page.getByRole('option', { name: /index.ts/ })).toBeVisible();
    await expect(page.locator('.pe-footer input')).toHaveValue('/project/src');
    expect(await page.locator('.pe-shell').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `../../.codex-tmp/project-folder-preview/${mode}-compact-subfolder.png` });
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect(page.getByRole('option', { name: /README.md/ })).toBeVisible();
    await page.locator('.pe-files').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('selected')).toHaveText('two');
    expect(calls.some(call => call.operation === 'guiFileAction')).toBe(false);
  });

  test(`${mode} pins a thread and branches the clicked conversation without preselecting`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop sidebar menus');
    const calls = await setup(page, mode);
    const row = page.getByRole('button', { name: '项目对话', exact: true });
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
    await row.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '取消置顶', exact: true })).toBeVisible();
    await expect(page.getByTestId('selected')).toHaveText('none');
    await page.getByRole('menuitem', { name: '创建分支', exact: true }).click();
    await expect(page.getByTestId('selected')).toHaveText('fork');
    expect(calls.filter(call => call.operation === 'forkLatest'))
      .toEqual([{ operation: 'forkLatest', threadId: 'one' }]);
    expect(calls.filter(call => call.operation === 'threadPin'))
      .toEqual([{ operation: 'threadPin', threadId: 'one', pinned: true }]);
  });
}
