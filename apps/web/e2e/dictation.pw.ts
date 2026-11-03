import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { GUI_ACCOUNTS_EVENT }: typeof import('../../../shared/remote-chat/guiAccounts') =
  require('../../../shared/remote-chat/guiAccounts');

type Reply = { text: string } | { error: string };
interface Request { action: string; sessionId?: string; data?: string; mimeType?: string }

async function fixture(page: Page, project: string, dark = false) {
  const calls: Request[] = [];
  const replies: ((reply: Reply) => void)[] = [];
  let prepareError = '';
  await page.route('**/web/test-dictation', async route => {
    const body = route.request().postDataJSON() as Request;
    calls.push(body);
    let reply: Reply | { sessionId: string } = { sessionId: `session-${calls.length}` };
    if (body.action === 'prepare' && prepareError) reply = { error: prepareError };
    if (body.action === 'transcribe') reply = await new Promise<Reply>(resolve => replies.push(resolve));
    await route.fulfill({ status: 'error' in reply ? 400 : 200, json: reply });
  });
  const path = project === 'desktop-remote' ? '/e2e/remote-dictation-harness.html' : '/web/e2e/dictation-harness.html';
  await page.goto(path + (dark ? '?dark' : ''));
  const editor = page.getByRole('textbox', { name: '聊天消息' });
  await expect(editor).toBeVisible();
  return { calls, editor, reply: (reply: Reply) => replies.shift()?.(reply),
    failPrepare: (error: string) => { prepareError = error; },
    uploads: () => calls.filter(call => call.action === 'transcribe') };
}

const start = async (page: Page) => {
  await page.getByRole('button', { name: '语音输入', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '正在录音' })).toContainText('0:01');
};
const stop = (page: Page) => page.getByRole('button', { name: '结束录音并转写' }).click();

test('keeps recording and transcription alive through balance refreshes', async ({ page }, info) => {
  const backend = await fixture(page, info.project.name);
  await backend.editor.fill('保留草稿');
  await start(page);
  const refreshBalance = () => page.evaluate(method => {
    window.dispatchEvent(new CustomEvent('dictation-host-event', { detail: { method, params: {} } }));
  }, GUI_ACCOUNTS_EVENT);
  await refreshBalance();
  await expect(page.getByRole('button', { name: '结束录音并转写' })).toBeVisible();
  await expect(page.locator('.chat-composer-submit')).toBeDisabled();
  await stop(page);
  await expect.poll(() => backend.uploads().length).toBe(1);
  await refreshBalance();
  await expect(page.locator('.chat-composer-submit')).toBeDisabled();
  backend.reply({ text: '余额刷新后仍然保留。' });
  await expect(backend.editor).toHaveValue('保留草稿\n余额刷新后仍然保留。');
  await expect(page.locator('.chat-composer-submit')).toBeEnabled();
  expect(backend.calls.filter(call => call.action === 'cancel')).toHaveLength(0);
});

for (const dark of [false, true]) {
  test(`records browser audio, retries and appends to the latest draft (${dark ? 'dark' : 'light'})`,
    async ({ page }, info) => {
      const backend = await fixture(page, info.project.name, dark);
      const send = page.locator('.chat-composer-submit');
      await backend.editor.fill('原有草稿');
      const microphone = page.getByRole('button', { name: '语音输入', exact: true });
      const micBounds = (await microphone.boundingBox())!;
      expect(micBounds.x + micBounds.width).toBeLessThanOrEqual((await send.boundingBox())!.x);
      await start(page);
      await expect(send).toBeDisabled();
      await backend.editor.press('Enter');
      await expect(page.getByRole('status', { name: '已发送' })).toHaveText('');
      const panel = page.getByRole('status').filter({ hasText: '正在录音' });
      const bounds = (await panel.boundingBox())!;
      expect(bounds.width).toBeLessThanOrEqual(400);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.screenshot({ path: info.outputPath('recording.png') });
      await stop(page);
      await expect.poll(() => backend.uploads().length).toBe(1);
      expect(backend.uploads()[0].mimeType).toContain('audio/webm');
      expect(Buffer.from(backend.uploads()[0].data!, 'base64').subarray(0, 4).toString('hex')).toBe('1a45dfa3');
      await expect(send).toBeDisabled();
      await backend.editor.fill('录音期间编辑的草稿');
      backend.reply({ error: '转写失败，请重试。' });
      await page.getByRole('button', { name: '重试转写' }).click();
      await expect.poll(() => backend.uploads().length).toBe(2);
      expect(backend.uploads()[1]).toEqual(backend.uploads()[0]);
      backend.reply({ text: '请检查代码。' });
      await expect(backend.editor).toHaveValue('录音期间编辑的草稿\n请检查代码。');
      await expect(backend.editor).toBeFocused();
      await expect(send).toBeEnabled();
      await expect(page.getByRole('status', { name: '已发送' })).toHaveText('');
      await page.screenshot({ path: info.outputPath('transcribed.png') });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}

for (const action of ['取消语音输入', '切换对话', '切换连接', '切换账户']) {
  test(`discards late transcription on ${action}`, async ({ page }, info) => {
    const backend = await fixture(page, info.project.name);
    await backend.editor.fill('保留草稿');
    await start(page);
    await stop(page);
    await expect.poll(() => backend.uploads().length).toBe(1);
    await page.getByRole('button', { name: action }).click();
    await expect.poll(() => backend.calls.filter(call => call.action === 'cancel').length).toBe(1);
    backend.reply({ text: '不应出现的旧结果' });
    await expect(page.getByRole('button', { name: '语音输入', exact: true })).toBeVisible();
    await expect(backend.editor).toHaveValue(action === '切换对话' ? '' : '保留草稿');
    if (action === '切换连接') {
      await expect(page.getByRole('button', { name: '语音输入', exact: true })).toBeDisabled();
    }
  });
}

test('stops microphone tracks on cancel and handles permission denial', async ({ page }, info) => {
  const backend = await fixture(page, info.project.name);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await original(constraints);
      stream.getTracks().forEach(track => {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); document.body.dataset.microphoneStopped = track.readyState; };
      });
      return stream;
    };
  });
  await start(page);
  await page.getByRole('button', { name: '取消语音输入' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-microphone-stopped', 'ended');
  expect(backend.uploads()).toHaveLength(0);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.getByRole('button', { name: '语音输入', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请允许使用麦克风，再重新录音。');
});

test('explains unsupported recording and follows live language switching', async ({ page }, info) => {
  await fixture(page, info.project.name);
  await page.evaluate(() => Object.defineProperty(navigator, 'mediaDevices', { value: undefined }));
  await page.getByRole('button', { name: '语音输入', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('HTTPS');
  for (const language of ['English', '日本語', 'Русский']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    await expect(page.getByRole('alert')).not.toContainText('当前环境');
    await expect(page.getByRole('alert')).not.toContainText('client.dictation.');
  }
});

test('reports account validation failure before asking for microphone access', async ({ page }, info) => {
  const backend = await fixture(page, info.project.name);
  backend.failPrepare('请先切换到 ChatGPT 账号，再使用语音输入。');
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new Error('Microphone must not be requested'); };
  });
  await page.getByRole('button', { name: '语音输入', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('请先切换到 ChatGPT 账号');
  await expect(page.getByRole('button', { name: '重试转写' })).toHaveCount(0);
});

test('keeps an empty mobile composer clear of the microphone controls', async ({ page }, info) => {
  const { editor } = await fixture(page, info.project.name);
  const mic = (await page.getByRole('button', { name: '语音输入', exact: true }).boundingBox())!;
  if (info.project.name === 'web-mobile') {
    const input = (await editor.boundingBox())!;
    expect(input.x + input.width).toBeLessThanOrEqual(mic.x);
  }
  await page.screenshot({ path: info.outputPath('empty-composer.png') });
});

for (const dark of [false, true]) {
  test(`uses the empty mobile send position for voice input (${dark ? 'dark' : 'light'})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'web-mobile');
    const backend = await fixture(page, info.project.name, dark);
    const primary = page.locator('.chat-composer-submit');
    await expect(primary).toHaveAccessibleName('语音输入');
    await expect(primary).toBeEnabled();
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toHaveCount(0);
    await backend.editor.fill('   ');
    await expect(primary).toHaveAccessibleName('语音输入');
    await backend.editor.fill('');
    await page.screenshot({ path: info.outputPath('mobile-voice-empty.png') });
    await primary.click();
    await expect(primary).toHaveAccessibleName('结束录音并转写');
    await expect(page.getByRole('status').filter({ hasText: '正在录音' })).toContainText('0:01');
    await page.screenshot({ path: info.outputPath('mobile-voice-recording.png') });
    await primary.click();
    await expect(primary).toBeDisabled();
    await expect.poll(() => backend.uploads().length).toBe(1);
    backend.reply({ text: '请检查代码。' });
    await expect(backend.editor).toHaveValue('请检查代码。');
    await expect(primary).toHaveAccessibleName('发送消息');
    await expect(page.getByRole('status', { name: '已发送' })).toHaveText('');
    await expect(page.locator('.ant-popover:visible')).toHaveCount(0);
    await page.mouse.move(190, 300);
    await page.screenshot({ path: info.outputPath('mobile-voice-draft.png') });
    await backend.editor.fill('');
    await page.getByRole('button', { name: '切换运行' }).click();
    await expect(primary).toHaveAccessibleName('暂停生成');
    await primary.click();
    await expect(primary).toHaveAccessibleName('继续生成');
    await page.screenshot({ path: info.outputPath('mobile-voice-continue.png') });
    await backend.editor.fill('文字优先发送');
    await expect(primary).toHaveAccessibleName('发送消息');
  });
}
