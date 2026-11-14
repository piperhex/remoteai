import { expect, test, type Page } from '@playwright/test';

const card = (page: Page) => page.getByRole('region', { name: '问题', exact: true });
const next = (page: Page) => card(page).getByRole('navigation').getByRole('button', { name: '下一题' });
const previous = (page: Page) => card(page).getByRole('button', { name: '上一题' });
const route = (mode: string, extra = '') => `/e2e/question-dialog-harness.html?mode=${mode}&options&multi${extra}`;

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: preserves drafts and separate requests when submitting grouped answers`, async ({ page }) => {
    const replies: string[][] = [];
    await page.route('**/question-answer', async request => {
      replies.push(request.request().postDataJSON()); await request.fulfill({ json: {} });
    });
    await page.goto(route(mode, '&multiple'));
    await expect(card(page)).toHaveCount(1);
    await expect(card(page).getByText('1 / 3')).toBeVisible();
    await expect(previous(page)).toBeDisabled();
    await page.getByRole('textbox').fill('第一题自定义回复');
    await next(page).click();
    await expect(card(page).getByText('2 / 3')).toBeVisible();
    await page.getByRole('textbox').fill('第二题自定义回复');
    await previous(page).click();
    await expect(page.getByRole('textbox')).toHaveValue('第一题自定义回复');
    await next(page).click();
    await expect(page.getByRole('textbox')).toHaveValue('第二题自定义回复');
    await card(page).getByRole('button', { name: '发送', exact: true }).click();
    await expect(card(page).getByText('1 / 1')).toBeVisible();
    expect(replies).toEqual([['第一题自定义回复', '第二题自定义回复']]);
    await expect(next(page)).toBeDisabled();
    await card(page).getByRole('button', { name: '跳过', exact: true }).click();
    await expect(card(page)).toHaveCount(0);
    expect(replies).toHaveLength(1);
  });

  test(`${mode}: skips without accepting suggestions and resets drafts across conversations`, async ({ page }) => {
    const replies: string[][] = [];
    await page.route('**/question-answer', async request => {
      replies.push(request.request().postDataJSON()); await request.fulfill({ json: {} });
    });
    await page.goto(route(mode));
    await page.getByRole('textbox').fill('不能带到另一会话');
    await page.getByRole('button', { name: '切换会话' }).click();
    await expect(page.getByRole('textbox')).toHaveValue('');
    await card(page).getByRole('button', { name: '跳过', exact: true }).click();
    expect(replies).toHaveLength(0);
    await card(page).getByRole('button', { name: '发送', exact: true }).click();
    await expect(card(page)).toHaveCount(0);
    expect(replies).toEqual([['此题已跳过，暂不回答。', '调整提示位置和字号（推荐）']]);
  });

  test(`${mode}: records audio, retries, appends to the latest draft and discards late results after paging`,
    async ({ page }, info) => {
      const requests: { action: string; data?: string; mimeType?: string }[] = [];
      let respond: ((value: { text?: string; error?: string }) => void) | undefined;
      await page.route('**/question-dictation', async request => {
        const body = request.request().postDataJSON(); requests.push(body);
        const result = body.action === 'transcribe'
          ? await new Promise<{ text?: string; error?: string }>(resolve => { respond = resolve; })
          : { sessionId: 'recording' };
        await request.fulfill({ status: 'error' in result ? 400 : 200, json: result });
      });
      await page.goto(route(mode, '&dark'));
      await page.getByRole('textbox').fill('原有回复');
      await card(page).getByRole('button', { name: '语音输入', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '正在录音' })).toContainText('0:01');
      await page.screenshot({ path: info.outputPath(`${mode}-recording.png`) });
      await card(page).getByRole('button', { name: '结束录音并转写' }).click();
      const uploads = () => requests.filter(value => value.action === 'transcribe');
      await expect.poll(() => uploads().length).toBe(1);
      expect(uploads()[0].mimeType).toContain('audio/webm');
      expect(Buffer.from(uploads()[0].data!, 'base64').subarray(0, 4).toString('hex')).toBe('1a45dfa3');
      respond?.({ error: '转写失败，请重试。' });
      await page.getByRole('button', { name: '重试转写' }).click();
      await expect.poll(() => uploads().length).toBe(2);
      await page.getByRole('textbox').fill('转写期间修改的回复');
      respond?.({ text: '请继续检查。' });
      await expect(page.getByRole('textbox')).toHaveValue('转写期间修改的回复\n请继续检查。');
      await expect(page.getByRole('textbox')).toBeFocused();
      await expect(page.locator('.ant-popover:visible')).toHaveCount(0);
      await expect.poll(() => page.getByRole('textbox').evaluate(element =>
        element.scrollHeight <= element.clientHeight + 2)).toBe(true);
      await page.mouse.move(0, 0);
      await card(page).screenshot({ path: info.outputPath(`${mode}-transcribed.png`), animations: 'disabled' });
      await card(page).getByRole('button', { name: '语音输入', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '正在录音' })).toContainText('0:01');
      await card(page).getByRole('button', { name: '结束录音并转写' }).click();
      await expect.poll(() => uploads().length).toBe(3);
      await next(page).click();
      await expect.poll(() => requests.some(value => value.action === 'cancel')).toBe(true);
      respond?.({ text: '过期转写' });
      await expect(page.getByRole('textbox')).toHaveValue('');
      await previous(page).click();
      await expect(page.getByRole('textbox')).toHaveValue('转写期间修改的回复\n请继续检查。');
    });
}

test('switches all released languages without missing keys', async ({ page }) => {
  await page.goto(route('web'));
  for (const [language, title] of [['en', 'Question'], ['ja', '質問'], ['ru', 'Вопрос'], ['zh', '问题']]) {
    await page.getByRole('button', { name: language, exact: true }).click();
    await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('client.questions.');
  }
});
