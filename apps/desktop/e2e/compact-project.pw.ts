import { expect, test, type Page, type Locator } from '@playwright/test';

async function installNativeEvents(page: Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: object) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let sequence = 0;
    Object.assign(window, { __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (callback: (event: object) => void) => {
        callbacks.set(++sequence, callback); return sequence;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (command: string, args: {
        event: string; handler: number; eventId: number; request: { directory: string; paths: string[] };
      }) => {
        if (command === 'plugin:event|listen') {
          listeners.set(++sequence, { event: args.event, handler: args.handler }); return sequence;
        }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (command === 'codex_gui_dropped_files') return { references: args.request.paths.map(path => ({
          kind: path.endsWith('.txt') ? 'file' : 'folder', path, name: path.split(/[\\/]/).at(-1),
        })), files: [] };
        if (command === 'codex_gui_request') {
          if (args.request.directory.endsWith('.txt')) throw new Error('Not a directory');
          return { data: { directory: args.request.directory.replaceAll('\\', '/'),
            entries: [], parent: 'C:/', truncated: false } };
        }
        if (command === 'plugin:dialog|open') return 'C:/点击选择';
        throw new Error(`Unexpected command ${command}`);
      },
    }, projectDropFixture: {
      emit: (type: string, x: number, y: number, paths: string[]) => {
        for (const [id, listener] of listeners) {
          if (listener.event === `tauri://drag-${type}`) callbacks.get(listener.handler)?.({
            id, event: listener.event, payload: { paths, position: { x, y } },
          });
        }
      },
      listenerCount: () => [...listeners.values()].filter(listener => listener.event.startsWith('tauri://drag-')).length,
    } });
  });
}

async function dropOn(page: Page, target: Locator, paths: string[], type = 'drop') {
  await target.click({ trial: true });
  const bounds = (await target.boundingBox())!;
  await page.evaluate(({ type, bounds, paths }) => {
    const fixture = (window as unknown as { projectDropFixture: {
      emit: (type: string, x: number, y: number, paths: string[]) => void;
    } }).projectDropFixture;
    fixture.emit(type, (bounds.x + bounds.width / 2) * devicePixelRatio,
      (bounds.y + bounds.height / 2) * devicePixelRatio, paths);
  }, { type, bounds, paths });
}

async function chooseProject(page: Page, width: number, screenshot: string) {
  if (width < 768) await page.getByRole('button', { name: '更多项目选项', exact: true }).click();
  await page.getByRole('button', { name: '选择项目文件夹：项目 空格' }).click();
  if (width >= 768) {
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.locator('.pe-address-edit').click();
    await page.getByRole('textbox', { name: '文件夹地址' }).fill('C:/第二个目录');
    await page.keyboard.press('Enter');
    await expect(page.locator('.pe-footer input')).toHaveValue('C:/第二个目录');
    await page.screenshot({ path: screenshot });
    await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
    return '第二个目录';
  }
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建项目', exact: true });
  const folder = dialog.getByRole('button', { name: '拖入文件夹，或点击选择' });
  await dialog.getByRole('textbox', { name: '项目名称' }).fill('自定义项目');
  await dropOn(page, folder, ['C:/第二个目录'], 'enter');
  await expect(folder).toHaveAttribute('data-dragging', 'true');
  await page.screenshot({ path: screenshot });
  await dropOn(page, folder, ['C:/第二个目录']);
  await expect(dialog.getByRole('textbox', { name: '项目名称' })).toHaveValue('自定义项目');
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  return '自定义项目';
}

for (const width of [390, 1280]) {
  for (const dark of [false, true]) {
    test(`compact capacity notice and directory projects at ${width}px ${dark ? 'dark' : 'light'}`,
      async ({ page }, info) => {
        await page.setViewportSize({ width, height: 800 });
        await page.route('https://fonts.googleapis.com/**', route => route.abort());
        await installNativeEvents(page);
        await page.goto(`/e2e/compact-project-harness.html${dark ? '?dark' : ''}`);
        const cards = page.getByText('当前模型繁忙，请换个模型重试。', { exact: true })
          .locator('../..');
        await expect(cards).toHaveCount(4, { timeout: 30_000 });
        for (const card of await cards.all()) {
          expect((await card.boundingBox())!.height).toBeLessThanOrEqual(width < 600 ? 100 : 56);
          expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        }
        const progress = await page.locator('[data-message-id="attempt-one"] p').boundingBox();
        const firstRepeated = await cards.nth(1).boundingBox();
        expect(firstRepeated!.y - (progress!.y + progress!.height)).toBeLessThanOrEqual(16);
        const nextProcess = await page.locator('[data-turn-id="failed"] > details').nth(1)
          .locator(':scope > summary').boundingBox();
        expect(nextProcess!.y - (firstRepeated!.y + firstRepeated!.height)).toBeLessThanOrEqual(16);
        await page.getByRole('button', { name: '重试', exact: true }).click();
        await expect(page.getByLabel('重试次数')).toHaveText('1');
        await page.screenshot({ path: info.outputPath('compact-conversation.png') });
        await page.getByLabel('消息草稿').fill('保留草稿');
        const target = page.getByTestId('project-drop-target');
        await expect.poll(() => page.evaluate(() => (window as unknown as {
          projectDropFixture: { listenerCount: () => number };
        }).projectDropFixture.listenerCount())).toBe(4);
        await dropOn(page, target, ['C:\\项目 空格'], 'enter');
        await expect(target.locator('div[role="status"]')).toHaveText('松开以添加文件或文件夹');
        await dropOn(page, target, ['C:\\项目 空格']);
        await expect(page.getByLabel('项目路径')).toHaveText('C:/项目 空格');
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-switch:gui-projects')!)))
          .toEqual([{ path: 'C:/项目 空格', name: '项目 空格' }]);
        const selectedName = await chooseProject(page, width, info.outputPath('project-drop-dialog.png'));
        await expect(page.getByLabel('项目路径')).toHaveText('C:/第二个目录');
        await dropOn(page, target, ['C:/第二个目录']);
        if (width < 768) await page.getByRole('button', { name: '更多项目选项', exact: true }).click();
        await expect(page.getByRole('button', { name: `选择项目文件夹：${selectedName}` })).toBeVisible();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('codex-switch:gui-projects')!)[0]))
          .toEqual({ path: 'C:/第二个目录', name: selectedName });
        await dropOn(page, target, ['C:/file.txt']);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.getByLabel('项目路径')).toHaveText('C:/第二个目录');
        await expect(page.getByLabel('消息草稿')).toHaveValue('保留草稿');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      });
  }
}
