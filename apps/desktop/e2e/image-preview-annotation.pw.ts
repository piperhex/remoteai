import { expect, test, type Page } from '@playwright/test';

async function localCommands(page: Page) {
  const source = await page.request.get('/src-tauri/icons/128x128.png').then(async response =>
    `data:image/png;base64,${(await response.body()).toString('base64')}`);
  const thread = { id: 'annotation', name: '图片标注', cwd: '', preview: '', updatedAt: 1,
    turns: [{ id: 'turn', status: 'completed', items: [
      { id: 'answer', type: 'agentMessage', text: `![界面截图](${source})` },
    ] }] };
  const sent: unknown[] = [];
  await page.route('**/__codex_switch__/api/invoke', async route => {
    const { command, args = {} } = route.request().postDataJSON();
    let result: unknown = {};
    if (command === 'codex_gui_connect') result = [];
    if (command === 'codex_gui_cli_status') result = { version: '0.166.0' };
    if (command === 'codex_gui_queue_read') result = { revision: 0, threads: {} };
    if (command === 'codex_gui_queue_save') result = args.snapshot;
    if (command === 'codex_gui_model_settings') result = { threadId: null, selection: null, revision: 0 };
    if (command === 'codex_gui_events') result = { cursor: { streamId: 'test', sequence: 1 }, events: [] };
    if (command === 'codex_gui_request') {
      const request = args.request;
      let data: unknown = { data: [], nextCursor: null };
      if (request.operation === 'list') data = { data: [thread], nextCursor: null };
      if (request.operation === 'read' || request.operation === 'resume') data = { thread };
      if (request.operation === 'goals') data = { goals: [] };
      if (request.operation === 'models') data = { data: [{ id: 'test', model: 'test', displayName: 'GPT-6',
        isDefault: true, defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [{ reasoningEffort: 'high', description: '' }] }], nextCursor: null };
      if (request.operation === 'send') {
        sent.push(request); data = { turn: { id: 'sent', status: 'inProgress', items: [] } };
      }
      result = { data };
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  return { source, sent };
}

async function draw(page: Page) {
  const editor = page.frameLocator('iframe[title="图片标注"]');
  await editor.getByRole('button', { name: '画笔', exact: true }).click();
  const box = await editor.locator('canvas').boundingBox();
  if (!box) throw new Error('Annotation canvas missing');
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .65, box.y + box.height * .6, { steps: 12 });
  await page.mouse.up();
  await expect(editor.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
}

async function expectDraftText(page: Page) {
  await expect.poll(() => page.getByRole('textbox', { name: /^(聊天)?消息$/ }).evaluate(element =>
    element instanceof HTMLTextAreaElement ? element.value : element.textContent)).toBe('请查看我圈出的内容');
}

for (const mode of ['local', 'remote', 'web']) {
  for (const narrow of [false, true]) {
    test(`${mode}: annotation opens a canvas and adds the result to the draft${narrow ? ' (narrow, dark)' : ''}`,
      async ({ page }, info) => {
        await page.setViewportSize({ width: narrow ? (mode === 'web' ? 900 : 800) : 1440, height: 960 });
        await page.route('https://fonts.googleapis.com/**', route => route.abort());
        const local = mode === 'local' ? await localCommands(page) : null;
        const dark = narrow ? '&dark' : '';
        await page.goto(mode === 'local' ? `/e2e/gui-features-harness.html?annotation${dark}`
          : `/e2e/image-preview-annotation-harness.html?mode=${mode}${dark}`);
        if (local) {
          const expand = page.getByRole('button', { name: '展开对话列表', exact: true });
          if (await expand.isVisible()) await expand.click();
          await page.getByRole('button', { name: '图片标注', exact: true }).click();
        }
        const input = page.getByRole('textbox', { name: /^(聊天)?消息$/ });
        await input.fill('请查看我圈出的内容');
        const attachments = page.locator(mode === 'local' ? '[aria-label="图片附件"] img' : '.chat-attachment-preview img');
        await page.locator('input[type="file"][accept*="image"]').first().setInputFiles('src-tauri/icons/128x128.png');
        await expect(attachments).toHaveCount(1);
        const existing = await attachments.first().getAttribute('src');
        const open = async () => {
          await page.getByRole('button', { name: '放大查看：界面截图', exact: true }).click();
          await page.getByRole('button', { name: '标注', exact: true }).click();
          await expect(page.locator('dialog.cs-image-viewer')).toHaveCount(0);
          await expect(page.locator('.cs-image-ai-form')).toHaveCount(0);
          await expect(page.frameLocator('iframe[title="图片标注"]').getByRole('button',
            { name: '完成', exact: true })).toBeEnabled();
        };
        await open();
        await draw(page);
        await page.frameLocator('iframe').getByRole('button', { name: '取消', exact: true }).click();
        await expect(page.locator('.cs-image-viewer')).toBeVisible();
        await page.getByRole('button', { name: '关闭图片', exact: true }).click();
        await expect(attachments).toHaveCount(1);
        await expect(attachments.first()).toHaveAttribute('src', existing!);
        await expectDraftText(page);
        await open();
        await draw(page);
        const label = `${mode}-${narrow ? 'narrow-dark' : 'wide-light'}`;
        await page.screenshot({ path: info.outputPath(`${label}-annotating.png`) });
        await page.frameLocator('iframe').getByRole('button', { name: '完成', exact: true }).click();
        await expect(page.locator('iframe[title="图片标注"]')).toHaveCount(0);
        await expect(attachments).toHaveCount(2);
        await expect(attachments.first()).toHaveAttribute('src', existing!);
        const edited = await attachments.nth(1).getAttribute('src');
        expect(edited).toMatch(/^data:image\//);
        if (local) expect(edited).not.toBe(local.source);
        await expectDraftText(page);
        await expect(input).toBeFocused();
        const sent = async () => local?.sent ?? page.evaluate(() =>
          (window as unknown as { imageAnnotationFixture: { sent: unknown[] } }).imageAnnotationFixture.sent);
        expect(await sent()).toHaveLength(0);
        await page.screenshot({ path: info.outputPath(`${label}-in-draft.png`) });
        await page.getByRole('button', { name: '发送消息', exact: true }).click();
        await expect.poll(sent).toHaveLength(1);
        expect((await sent())[0]).toMatchObject({ text: '请查看我圈出的内容', images: [existing, edited] });
      });
  }
}
