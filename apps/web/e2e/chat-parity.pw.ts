import { expect, test, type Page } from '@playwright/test';
import { openChatList, connect, fixtureUrl, login, operationCount, screenshot, send, settled, state } from './chat-helpers';

const closeSheet = (page: Page) => page.getByRole('button', { name: '关闭', exact: true }).last().click();
async function selectChat(page: Page) {
  await openChatList(page);
  await page.getByRole('button', { name: '移动端聊天体验', exact: true }).click();
  await expect(page.getByRole('heading', { name: '移动端聊天体验', exact: true })).toBeVisible();
}
test.beforeEach(async ({ page, request }) => {
  await request.post(`${fixtureUrl}/test/reset`);
  await login(page);
  await connect(page);
  await expect(page.getByRole('status').filter({ hasText: 'P2P' })).toBeVisible({ timeout: 16_000 });
});

test('renders rich replies, folded work, nested output, file previews and reply quotes', async ({ page, request }, info) => {
  // Exercise the browser-download fallback; the native OS save picker is outside Playwright's page automation.
  await page.evaluate(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'web-parity' } });
  await selectChat(page);
  await expect(page.getByRole('heading', { name: '聊天界面测试', exact: true })).toBeVisible();
  await expect(page.locator('.chat-messages table')).toContainText('自动换行');
  await expect(page.locator('.chat-messages .chat-code-block pre')).toHaveText('const ready: boolean = true;');
  await expect(page.locator('.chat-messages .chat-code-block pre span[style]')).not.toHaveCount(0);
  await expect(page.locator('.chat-messages .chat-activity')).toHaveCount(0);
  await expect(page.locator('.chat-messages').getByRole('button', { name: '下载', exact: true })).toHaveCount(0);
  await screenshot(page, info, 'rich-chat');
  await page.getByRole('button', { name: /查看处理过程/ }).click();
  if (info.project.name === 'desktop') await page.getByRole('button', { name: /查看连续操作/ }).click();
  await page.getByRole('button', { name: /执行命令.*npm test/ }).click();
  await expect(page.getByText('OUTPUT_START', { exact: false }).last()).toBeVisible();
  while (await page.getByRole('button', { name: '显示更多内容' }).count()) {
    await page.getByRole('button', { name: '显示更多内容' }).click();
  }
  await expect(page.getByText('OUTPUT_END', { exact: false }).last()).toBeVisible();
  const desktop = info.project.name === 'desktop';
  if (desktop) await page.getByRole('button', { name: /执行命令.*npm test/ }).click();
  else await page.getByRole('button', { name: '返回上一层' }).click();
  await expect(page.getByRole('button', { name: /执行命令.*npm test/ })).toBeVisible();
  await page.getByRole('button', { name: /preview/ }).click();
  if (!desktop) await expect(page.getByRole('heading', { name: '工具结果' })).toBeVisible();
  await expect(page.getByRole('img', { name: '工具返回的图片' })).toBeVisible();
  if (desktop) await page.getByRole('button', { name: /preview/ }).click();
  else {
    await closeSheet(page);
    await page.getByRole('button', { name: /查看处理过程/ }).click();
  }
  await page.getByRole('button', { name: /^文件修改/ }).click();
  if (desktop) {
    await page.getByRole('button', { name: /^查看文件修改记录：/ }).click();
    await expect(page.getByRole('complementary', { name: '文件更改详情' })).toBeVisible();
    await page.getByRole('button', { name: '关闭详情抽屉' }).click();
  } else {
    await expect(page.locator('.ant-drawer-right .chat-diff')).toBeVisible();
    await page.locator('.chat-diff-file summary').first().click();
    await expect(page.locator('.chat-diff-line.remove').first()).toBeVisible();
  }
  if (desktop) await page.getByRole('button', { name: /^文件修改/ }).click();
  else await page.getByRole('button', { name: '返回上一层' }).click();
  await expect(page.getByRole('button', { name: /^文件修改/ })).toBeVisible();
  if (desktop) await page.getByRole('button', { name: /查看处理过程/ }).click();
  else await closeSheet(page);
  await page.getByRole('button', { name: /查看本轮修改：3 个文件/ }).click();
  if (desktop) {
    const details = page.getByRole('complementary', { name: '文件更改详情' });
    await expect(details).toBeVisible();
    await expect(details).toContainText('3 个文件');
    await details.getByRole('button', { name: '并排', exact: true }).click();
    await expect(details.getByText('修改前', { exact: true })).toBeVisible();
  } else {
    await expect(page.locator('.ant-drawer-right .chat-diff')).toBeVisible();
    await expect(page.locator('.chat-diff > section')).toHaveCount(2);
    await page.locator('.chat-diff-file summary').first().click();
    await expect(page.locator('.chat-diff-line.add').first()).toBeVisible();
  }
  await screenshot(page, info, 'grouped-diff');
  if (desktop) await page.getByRole('button', { name: '关闭详情抽屉' }).click();
  else await closeSheet(page);
  await page.getByRole('button', { name: '查看文件', exact: true }).click();
  await expect(page.getByText('引用位置：第 2 行')).toBeVisible();
  await expect(page.getByRole('button', { name: '复制文件内容' })).toBeVisible();
  await expect(page.getByRole('button', { name: '下载', exact: true })).toBeVisible();
  await screenshot(page, info, 'file-preview-download');
  await closeSheet(page);
  await page.getByRole('button', { name: '播放视频', exact: true }).click();
  await expect(page.locator('video')).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '下载', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存到设备', exact: true })).toBeVisible();
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存到设备', exact: true }).click();
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe('test.mp4');
  expect(await saved.failure()).toBeNull();
  await expect(page.getByText('可在设置中的“下载管理”查看进度。')).toBeVisible();
  await closeSheet(page);
  await page.locator('.chat-assistant-message').last().getByRole('button', { name: '引用回复' }).click();
  await expect(page.getByRole('button', { name: '移除引用' })).toBeVisible();
  await send(page, '继续检查引用内容');
  await settled(page);
  const sent = (await state(request)).operations.findLast(entry => entry.operation === 'send');
  expect(sent?.text).toContain('聊天界面测试');
  expect(sent?.text).toContain('继续检查引用内容');
  await expect(page.getByRole('button', { name: '移除引用' })).toHaveCount(0);
  await expect(page.locator('.chat-message-quote')).toBeVisible();
  expect(errors).toEqual([]);
});

test('sends skills, plugin and file capsules and keeps goal controls removable', async ({ page, request }, info) => {
  const input = page.getByRole('textbox', { name: '聊天消息' });
  await input.fill('/');
  await expect(page.getByRole('menuitem', { name: '目标模式' })).toBeVisible();
  await page.getByRole('menuitem', { name: '使用技能 代码检查', exact: true }).click();
  await expect(input).toHaveValue('$review ');
  await page.getByRole('button', { name: '添加内容', exact: true }).click();
  await page.getByRole('menuitem', { name: '插件', exact: true }).click();
  await page.getByRole('menuitem', { name: '使用插件 GitHub' }).click();
  await expect(page.getByRole('button', { name: '移除GitHub', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加内容', exact: true }).click();
  await page.getByRole('menuitem', { name: '项目文件', exact: true }).click();
  await page.getByRole('button', { name: 'assets', exact: true }).click();
  await page.getByRole('button', { name: 'notes.txt', exact: true }).click();
  await page.getByRole('button', { name: '添加内容', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await (await chooser).setFiles({ name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('Web file test') });
  await expect(page.getByRole('button', { name: '移除test.txt' })).toBeVisible();
  await screenshot(page, info, 'composer-capsules');
  await page.getByRole('button', { name: '发送消息' }).click();
  await settled(page);
  const sent = (await state(request)).operations.findLast(entry => entry.operation === 'send');
  expect(sent?.skills).toEqual([{ name: 'review', path: 'F:/skills/review/SKILL.md' }]);
  expect(sent?.attachments).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'plugin', path: 'plugin://github@fixture' }),
    expect.objectContaining({ kind: 'file', path: 'F:/projects/demo/assets/notes.txt' }),
    expect.objectContaining({ name: 'test.txt', data: Buffer.from('Web file test').toString('base64') }),
  ]));
  await input.fill('/goal');
  await page.getByRole('menuitem', { name: '目标模式' }).click();
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', '描述想完成的目标…');
  await send(page, '完成聊天界面测试');
  await expect.poll(() => operationCount(request, 'goalSet')).toBe(1);
  await expect(page.getByRole('button', { name: '退出目标模式' })).toBeVisible();
  await page.getByRole('button', { name: '退出目标模式' }).click();
  await expect.poll(() => operationCount(request, 'goalClear')).toBe(1);
  await expect(page.getByRole('button', { name: '退出目标模式' })).toHaveCount(0);
});

test('changes context capacity and opens profile, account picker and token summary', async ({ page, request }, info) => {
  await selectChat(page);
  const desktop = info.project.name === 'desktop';
  if (desktop) {
    await page.getByRole('button', { name: '查看上下文用量' }).click();
    const context = page.getByRole('dialog', { name: '背景信息窗口' });
    await expect(context).toContainText('暂无上下文用量');
    await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'context-usage' } });
    await expect(context).toContainText('6% 已用（剩余 94%）');
    await expect(context).toContainText('已用 14.6K Token，共 258.4K');
    await screenshot(page, info, 'context-window');
    await page.getByRole('button', { name: '设置当前对话的上下文容量' }).click();
    await page.getByRole('combobox', { name: '上下文容量（K Token）' }).click();
    await page.locator('.ant-select-item-option').getByText('400K', { exact: true }).click();
  } else {
    await page.getByRole('button', { name: /聊天设置/ }).click();
    await page.getByRole('button', { name: '对话上下文设置', exact: true }).click();
    await page.getByRole('button', { name: '400K', exact: true }).click();
  }
  await expect(page.getByRole(desktop ? 'combobox' : 'textbox', { name: '上下文容量（K Token）' })).toHaveValue('400');
  await screenshot(page, info, 'context-capacity');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(async () => (await state(request)).operations.findLast(entry =>
    entry.operation === 'contextSettingsWrite')?.settings).toEqual({ capacity: 400000 });
  if (desktop) {
    await expect(page.getByRole('dialog', { name: '对话上下文设置' })).toHaveCount(0);
    await page.getByRole('button', { name: '查看上下文用量' }).click();
    await expect(page.getByRole('dialog', { name: '背景信息窗口' })).toContainText('对话设置：400K Token');
    await page.keyboard.press('Escape');
  } else await closeSheet(page);
  await openChatList(page);
  await page.getByRole('button', { name: '打开头像菜单' }).click();
  await page.getByRole('button', { name: '切换账户', exact: true }).click();
  await expect(page.getByRole('button', { name: '演示账户一', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '演示账户二', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换账户', exact: true })).toContainText('演示账户二');
  await page.getByRole('button', { name: 'Token 汇总', exact: true }).click();
  await expect(page.getByRole('heading', { name: '每日 Token 趋势' })).toBeVisible();
  await screenshot(page, info, 'token-summary');
  await page.getByRole('spinbutton', { name: '统计周数，1 至 52 周' }).fill('2');
  await page.getByRole('button', { name: '应用', exact: true }).click();
  await expect.poll(async () => (await state(request)).operations.findLast(entry =>
    entry.operation === 'tokenSummary')?.weeks).toBe(2);
  await closeSheet(page);
  const count = await operationCount(request, 'tokenSummary');
  await page.waitForTimeout(2300);
  expect(await operationCount(request, 'tokenSummary')).toBe(count);
});

test('answers asynchronous questions without blocking the draft and preserves independent search', async ({ page, request }) => {
  await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'async-parity' } });
  await selectChat(page);
  await page.getByRole('textbox', { name: '聊天消息' }).fill('草稿保持不变');
  await page.getByRole('button', { name: /回答补充问题/ }).click();
  await expect(page.getByRole('radio', { name: '输入框', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: '提交回答' })).toBeDisabled();
  await page.getByRole('radio', { name: '聊天记录', exact: true }).check();
  await page.getByRole('textbox', { name: '还有哪些细节？' }).fill('表格和代码高亮');
  await page.getByRole('button', { name: '提交回答' }).click();
  await expect(page.getByRole('button', { name: /回答补充问题/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '聊天消息' })).toHaveValue('草稿保持不变');
  await openChatList(page);
  await page.getByRole('button', { name: '搜索聊天', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索聊天' }).fill('不存在');
  await expect(page.getByText('没有找到相关聊天')).toBeVisible();
  await closeSheet(page);
  await expect(page.getByRole('button', { name: '移动端聊天体验', exact: true })).toBeVisible();
});

test('cancels a question without sending an answer and keeps it dismissed after reload',
  async ({ page, request }, info) => {
  await request.post(`${fixtureUrl}/test/sidebar`, { data: { action: 'async-parity' } });
  await selectChat(page);
  const input = page.getByRole('textbox', { name: '聊天消息' });
  await input.fill('保留这份草稿');
  await screenshot(page, info, 'question-delete');
  const before = await operationCount(request, 'queueEnqueue');
  await page.getByRole('button', { name: /回答补充问题/ }).click();
  await page.getByRole('button', { name: '取消回答', exact: true }).click();
  await expect(page.getByRole('button', { name: /回答补充问题/ })).toHaveCount(0);
  await expect(input).toHaveValue('保留这份草稿');
  expect(await operationCount(request, 'queueEnqueue')).toBe(before);
  expect(await operationCount(request, 'send')).toBe(0);
  await page.reload();
  await connect(page);
  await selectChat(page);
  await expect(page.getByRole('button', { name: /回答补充问题/ })).toHaveCount(0);
  await expect(page.locator('.chat-message-content')).toContainText('下一步验证什么？');
});
