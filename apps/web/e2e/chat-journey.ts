import { expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { openChatList, click, connect, navigate, operationCount, send, settled, screenshot, state, fixtureUrl } from './chat-helpers';
import { sidebarJourney } from './chat-sidebar';
import { existingChatSettings } from './chat-existing-settings';
import { groupPreviewJourney } from './chat-group-preview';
import { openChatSettings } from './chat-helpers';
import { chooseSetting, closeChatSettings, expectComposerSelection, isDesktop } from './chat-settings';

interface Journey { page: Page; request: APIRequestContext; info: TestInfo; transport?: 'direct' | 'either' }
const ready = (page: Page, transport?: Journey['transport']) => expect(page.getByRole('status')
  .filter({ hasText: transport === 'either' ? /P2P|Relay/ : 'P2P' }))
  .toBeVisible({ timeout: 16_000 });

async function initialChat({ page, request, info, transport }: Journey) {
  await connect(page);
  await ready(page, transport);
  await expect(page.getByText('欢迎回来', { exact: true })).toHaveCount(0);
  await screenshot(page, info, '00-new-chat');
  await openChatList(page);
  await expect(page.getByRole('region', { name: '演示项目', exact: true })).toBeVisible();
  await click(page.getByRole('button', { name: '移动端聊天体验', exact: true }));
  await expect(page.getByText('帮我整理今天的工作计划。')).toBeVisible();
  await send(page, 'H5 regression message');
  await expect(page.locator('.chat-markdown pre')).toHaveText('const connected = true;');
  await settled(page);
  expect(await operationCount(request, 'send')).toBe(1);
  if (transport !== 'either') expect((await state(request)).relayFrames).toBe(0);
  await screenshot(page, info, '01-connected-chat');
}

async function settingsAndContinue({ page, request }: Journey) {
  await openChatSettings(page);
  await chooseSetting(page, '模型', '测试模型');
  await chooseSetting(page, '推理强度', '高');
  await chooseSetting(page, '访问权限', '请求批准');
  await closeChatSettings(page);
  await send(page, 'slow task');
  await expect(page.getByRole('button', { name: '暂停生成' })).toBeVisible();
  const input = page.getByRole('textbox', { name: '聊天消息' });
  await click(page.getByRole('button', { name: '暂停生成' }));
  await expect(input).toHaveValue('');
  await click(page.getByRole('button', { name: '继续生成' }));
  await settled(page);
  expect((await state(request)).operations.filter((entry) => entry.operation === 'send').at(-1))
    .toMatchObject({ text: '请继续完成刚才中断的任务。', model: 'test-model', effort: 'high', access: 'read-only' });
}

async function approvals({ page, request, info }: Journey) {
  await send(page, 'approval accept');
  await expect(page.getByRole('region', { name: '需要你的确认' })).toBeVisible();
  await screenshot(page, info, '02-approval');
  await click(page.getByRole('button', { name: '允许这一次' }));
  await settled(page);
  await send(page, 'approval decline');
  await click(page.getByRole('button', { name: '拒绝', exact: true }));
  await settled(page);
  await send(page, 'question test');
  await page.getByRole('radio', { name: /继续验证/ }).check();
  await click(page.getByRole('button', { name: '提交回答' }));
  await settled(page);
  const decisions = (await state(request)).operations;
  expect(decisions.filter((entry) => entry.decision === 'accept')).toHaveLength(1);
  expect(decisions.filter((entry) => entry.decision === 'decline')).toHaveLength(1);
  expect(decisions.find((entry) => entry.answers)?.answers).toEqual({ choice: { answers: ['继续验证'] } });
}

async function manageHistory({ page, request }: Journey) {
  await openChatList(page);
  await click(page.getByRole('button', { name: '搜索聊天', exact: true }));
  await page.getByRole('textbox', { name: '搜索聊天' }).fill('不存在的任务');
  await click(page.getByRole('button', { name: '搜索', exact: true }));
  await expect(page.getByText('没有找到相关聊天')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索聊天' }).fill('');
  await click(page.getByRole('button', { name: '搜索', exact: true }));
  await click(page.getByRole('button', { name: '关闭', exact: true }).last());
  await click(page.getByRole('button', { name: '在 演示项目 中新建对话', exact: true }));
  await expect(page.locator('.chat-header')).toContainText('演示项目');
  await send(page, 'new chat from H5');
  await expect.poll(async () => (await state(request)).threads.at(-1)?.turns?.at(-1)?.status).toBe('completed');
  await settled(page);
  expect((await state(request)).threads).toHaveLength(2);
  expect((await state(request)).operations.findLast((entry) => entry.operation === 'start'))
    .toMatchObject({ cwd: 'F:/projects/demo' });
  await expect(page.locator('.chat-header').getByRole('button', { name: '归档', exact: true })).toHaveCount(0);
  await openChatList(page);
  await expect(page.getByRole('region', { name: '演示项目', exact: true })
    .getByRole('button', { name: '手机新聊天', exact: true })).toBeVisible();
  await click(page.getByRole('button', { name: '移动端聊天体验', exact: true }));
}

async function imagePreview({ page, request, info }: Journey) {
  await send(page, 'image preview');
  await settled(page);
  for (const description of ['本地图片', '网络图片']) {
    const image = page.getByRole('img', { name: description, exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await click(page.getByRole('button', { name: '放大查看：本地图片', exact: true }));
  await expect(page.getByRole('dialog', { name: '本地图片' })).toBeVisible();
  const original = page.getByRole('dialog').getByRole('img');
  await expect.poll(() => original.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(32);
  await click(page.getByRole('button', { name: '查看原图', exact: true }));
  await expect.poll(() => original.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    { timeout: 30_000 }).toBe(900);
  await expect(page.getByText('正在加载原图…', { exact: true })).toHaveCount(0);
  await click(page.getByRole('button', { name: '放大图片', exact: true }));
  await expect(page.getByRole('button', { name: '还原图片' })).toHaveText('150%');
  await click(page.getByRole('button', { name: '旋转图片', exact: true }));
  await expect(original).toHaveCSS('transform', /matrix\(0, 1.5, -1.5, 0, 0, 0\)/);
  await screenshot(page, info, '04-original-zoom-rotation');
  const chunks = await operationCount(request, 'fileRead');
  expect(chunks).toBeGreaterThan(1);
  await click(page.getByRole('button', { name: '关闭图片', exact: true }));
  await click(page.getByRole('button', { name: '放大查看：本地图片', exact: true }));
  await click(page.getByRole('button', { name: '查看原图', exact: true }));
  await expect.poll(() => page.getByRole('dialog').getByRole('img')
    .evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(900);
  expect(await operationCount(request, 'fileRead')).toBe(chunks);
  await click(page.getByRole('button', { name: '关闭图片', exact: true }));
  expect(await operationCount(request, 'previewOpen')).toBeGreaterThan(0);
  await screenshot(page, info, '04-inline-images');
}

async function incrementalRecovery({ page, request, info }: Journey) {
  const before = (await state(request)).synchronization.length;
  await request.post(`${fixtureUrl}/test/disconnect`);
  await expect.poll(async () => (await state(request)).synchronization.length).toBeGreaterThan(before);
  await ready(page, 'either');
  const updates = (await state(request)).synchronization.slice(before);
  expect(updates.every((update) => update.changedItems === 0 && update.bytes < 512)).toBe(true);
  expect(await operationCount(request, 'read')).toBe(0);
  await info.attach('incremental-reconnect-payloads', { body: JSON.stringify(updates), contentType: 'application/json' });
}

async function synchronizeComposer({ page, request, info }: Journey) {
  await request.post(`${fixtureUrl}/test/composer`, { data: {
    model: 'second-model', effort: 'xhigh', access: 'danger-full-access',
  } });
  await expect.poll(async () => (await state(request)).composer.settings.model).toBe('second-model');
  await openChatSettings(page);
  if (isDesktop(page)) await expectComposerSelection(page);
  else {
    await expect(page.locator('.chat-setting-entry')).toHaveCount(4);
    await expect(page.getByRole('button', { name: '设置速度模式', exact: true })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '设置模型' })).toContainText('第二模型');
    await expect(page.getByRole('button', { name: '设置推理强度' })).toContainText('极高');
    await screenshot(page, info, '05-settings-menu');
    await click(page.getByRole('button', { name: '设置模型' }));
    await expect(page.getByRole('radio', { name: '第二模型', exact: true })).toBeChecked();
    await screenshot(page, info, '06-model-drawer');
    await click(page.getByRole('button', { name: '返回上一层' }));
    await expect(page.getByRole('button', { name: '设置模型' })).toBeVisible();
  }
  for (const [label, access] of [['请求批准', 'read-only'], ['帮我批准', 'workspace-write'],
    ['完全访问', 'danger-full-access']]) {
    await chooseSetting(page, '访问权限', label);
    await expect.poll(async () => (await state(request)).composer.settings.access).toBe(access);
  }
  await chooseSetting(page, '模型', '测试模型');
  await chooseSetting(page, '推理强度', '高');
  await closeChatSettings(page);
  await send(page, 'send with synced settings');
  await settled(page);
  expect((await state(request)).operations.filter((entry) => entry.operation === 'send').at(-1))
    .toMatchObject({ model: 'test-model', effort: 'high', access: 'danger-full-access' });
  await screenshot(page, info, '05-synced-composer');
}

async function recoverConnection({ page, request, info, transport }: Journey) {
  const before = await state(request);
  const sent = await operationCount(request, 'send');
  const reads = await operationCount(request, 'syncHistory');
  await request.post(`${fixtureUrl}/test/disconnect`);
  await expect.poll(async () => (await state(request)).mobileConnections).toBeGreaterThan(before.mobileConnections);
  await ready(page, transport);
  await expect.poll(() => operationCount(request, 'syncHistory')).toBeGreaterThan(reads);
  expect(await operationCount(request, 'send')).toBe(sent);
  const connections = (await state(request)).mobileConnections;
  await navigate(page, '账号');
  await expect.poll(async () => (await state(request)).connectedMobiles).toBe(1);
  await navigate(page, '聊天');
  await ready(page, transport);
  expect((await state(request)).mobileConnections).toBe(connections);
  await expect(page.getByRole('heading', { name: '移动端聊天体验', exact: true })).toBeVisible();
  await request.post(`${fixtureUrl}/test/fallback`);
  await expect(page.getByRole('status').filter({ hasText: 'Relay' })).toBeVisible();
  await send(page, 'message after direct interruption');
  await settled(page);
  expect((await state(request)).relayFrames).toBeGreaterThan(0);
  expect((await state(request)).streamErrors).toEqual([]);
  expect((await state(request)).errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await screenshot(page, info, '03-relay-recovery');
}

export async function chatJourney(context: Journey) {
  const errors: string[] = [];
  context.page.on('pageerror', (error) => errors.push(error.message));
  await initialChat(context);
  await settingsAndContinue(context);
  await approvals(context);
  await manageHistory(context);
  await recoverConnection(context);
  await imagePreview(context);
  await incrementalRecovery(context);
  await synchronizeComposer(context);
  await existingChatSettings(context);
  await sidebarJourney(context);
  await groupPreviewJourney(context);
  expect(errors).toEqual([]);
}
