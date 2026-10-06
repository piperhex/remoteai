import type { RpcRequest } from '../../../shared/remote-chat/protocol';
import { GUI_TOOL_OPERATIONS } from '../../../shared/remote-chat/guiTools';
import { demoGuiTools } from './demo-gui-tools';
import type { ChatLink } from '../../../shared/remote-chat/link';
import type { GuiEvent, Item, Thread, Turn } from '../src/pages/codexGui/types';
import previewImage from '../src-tauri/icons/32x32.png?inline';
import { changeDemoComposer, composerErrors, demoComposer } from './demo-composer';
import { guiSidebar } from '../src/pages/codexGui/sidebarBridge';
import { SIDEBAR_EVENT } from '../../../shared/remote-chat/sidebar';
import { saveProject } from '../src/pages/codexGui/projectCatalog';
import { historyDelta, type HistoryVersion } from '../../../shared/remote-chat/historySync';
import { historyNotification } from '../../../shared/remote-chat/historyNotification';
import { RemoteImages } from '../src/remoteChat/images';
import { demoImageResponse } from './demo-images';
import { parseHistoryWindow, sliceHistory } from '../../../shared/remote-chat/historyPage';
import { seedDemoCompactHistory, seedDemoFooterHistory, seedDemoHistory, seedDemoOpeningHistory } from './demo-history';
import { demoSkills } from './demo-skills';
import { demoPlugins, demoProjectFiles } from './demo-attachments';
import { demoProjectDirectories } from './demo-project-directories';
import { demoQueueRequest, demoQueueSnapshot, flushDemoQueue } from './demo-queue';
import { demoGuiAccounts } from './demo-gui-accounts';
import { demoTokenSummary } from './demo-token-summary';
import { detailText, seedDemoDetails } from './demo-details';
import { demoVideoResponse, seedDemoVideo } from './demo-videos';
import { demoChatParityOperation, seedChatParity, seedAsyncQuestion } from './demo-chat-parity';
import { configureDownloadFixture, demoDownloads, seedDownloads } from './demo-downloads';
import { chatHandshake } from '../../../shared/remote-chat/handshake';

type DemoLink = Pick<ChatLink, 'send'>;

const images = new RemoteImages();
const synchronization: { bytes: number; changedItems: number; text: string }[] = [];

saveProject({ path: 'F:/projects/demo', name: '演示项目' });
let sidebarLink: DemoLink | undefined;
guiSidebar.subscribe((snapshot) => {
  if (sidebarLink) void sidebarLink.send({ kind: 'event', event: { method: SIDEBAR_EVENT, params: snapshot } })
    .catch((error: unknown) => streamErrors.push(String(error)));
});

const welcome: Thread = { id: 'demo-chat', name: '移动端聊天体验', preview: '继续电脑上的任务', cwd: 'F:/projects/demo',
  updatedAt: Math.floor(Date.now() / 1000), turns: [{ id: 'welcome', status: 'completed', items: [
    { id: 'question', type: 'userMessage', content: [{ type: 'text', text: '帮我整理今天的工作计划。' }] },
    { id: 'answer', type: 'agentMessage', text: '可以，今天先完成这三件事：\n\n1. 检查项目进度\n2. 处理需要确认的事项'
      + '\n3. 验证手机与电脑之间的同步\n\n你可以直接从手机继续这个任务。' },
  ] }] };
const fixtureDevice = new URLSearchParams(location.search).get('device');
if (fixtureDevice) {
  welcome.id = `demo-chat-${fixtureDevice}`;
  welcome.name = new URLSearchParams(location.search).get('title') || fixtureDevice;
}
const threads = new Map([[welcome.id, welcome]]);
const archived = new Set<string>();
const approvals = new Map<string, { event: GuiEvent; thread: Thread; turn: Turn; link: DemoLink }>();
const operations: Record<string, unknown>[] = [];
const streamErrors: string[] = [];
let sequence = 0;
const uniqueId = (name: string) => `${name}-${++sequence}`;

export function demoState() {
  return { threads: [...threads.values()], operations, synchronization,
    approvals: [...approvals.values()].map(({ event }) => event),
    streamErrors: [...streamErrors, ...composerErrors], archived: [...archived], composer: demoComposer(),
    sidebar: guiSidebar.snapshot(), queue: demoQueueSnapshot() };
}

export function demoResponse(request: RpcRequest, link: DemoLink): unknown {
  sidebarLink = link;
  if (request.method === 'connect') {
    const events = [...approvals.values()].map(({ event }) => event);
    return request.body === undefined ? events : { ...chatHandshake, approvals: events, filePreviewsV1: true };
  }
  const input = (request.body ?? {}) as Record<string, unknown>;
  operations.push({ ...input, method: request.method });
  const download = demoDownloads(input);
  if (download) return download.value;
  if (GUI_TOOL_OPERATIONS.has(String(input.operation))) return demoGuiTools(input);
  if (input.operation === 'usageSummary') return { totalTokens: 123456, estimatedCostUsd: 1.25,
    primaryRemainingPercent: 75, primaryRemainingAggregated: false, providerEstimatedCost: null };
  if (input.operation === 'tokenSummary') return demoTokenSummary(input);
  if (request.method === 'respond') return respond(input);
  if (input.operation === 'models') return { data: demoComposer().models, nextCursor: null, composer: demoComposer() };
  if (input.operation === 'skills') return { ...demoSkills(), ...(input.includePlugins ? { plugins: demoPlugins } : {}) };
  if (input.operation === 'projectFiles') return demoProjectFiles(input);
  if (input.operation === 'projectDirectories') return demoProjectDirectories(input);
  if (input.operation === 'composerSet') return changeDemoComposer(input.settings, link);
  if (input.operation === 'threadRead') return guiSidebar.markRead(input);
  if (input.operation === 'queueRead') return demoQueueSnapshot();
  if (input.operation === 'guiAccountsRead' || input.operation === 'guiAccountSelect') return demoGuiAccounts(input);
  if (input.operation === 'list') return { data: [...threads.values()].filter((thread) =>
    archived.has(thread.id) === (input.archived === true)
      && `${thread.name} ${thread.preview}`.includes(String(input.search ?? '')))
      .map(({ turns: _turns, ...thread }) => thread), nextCursor: null,
    sidebar: guiSidebar.observe([...threads.values()]) };
  if (input.operation === 'start') {
    const thread: Thread = { id: uniqueId('chat'), name: '手机新聊天', preview: '', cwd: String(input.cwd ?? ''),
      updatedAt: Math.floor(Date.now() / 1000), turns: [] };
    threads.set(thread.id, thread);
    notify(link, { method: 'thread/started', params: { thread } });
    return { thread };
  }
  const thread = threads.get(String(input.threadId));
  if (!thread) throw new Error('Unknown demo thread');
  return threadOperation(thread, input, link);
}

function threadOperation(thread: Thread, input: Record<string, unknown>, link: DemoLink) {
  const parity = demoChatParityOperation(thread, input);
  if (parity) return parity.value;
  if (['videoOpen', 'videoRead', 'videoClose'].includes(String(input.operation))) return demoVideoResponse(input);
  if (input.operation === 'textPreview') return { path: String(input.path), text: detailText };
  if (String(input.operation).startsWith('queue')) return demoQueueRequest(input, queueHost(thread, link));
  if (input.operation === 'syncHistory') {
    const sliced = sliceHistory(thread, parseHistoryWindow(input.window));
    const delta = { ...historyDelta(images.prepare(sliced.thread, thread.id), input.known as HistoryVersion | undefined),
      page: sliced.page };
    const text = JSON.stringify(delta);
    synchronization.push({ bytes: new TextEncoder().encode(text).length,
      changedItems: delta.turns.reduce((count, turn) => count + turn.items.length, 0), text });
    return delta;
  }
  if (input.operation === 'resume' && !thread.turns?.length) {
    throw new Error('New threads have no persisted rollout before the first turn');
  }
  if (input.operation === 'read') return { thread };
  if (input.operation === 'resume') return {};
  if (input.operation === 'compact') {
    setTimeout(() => notify(link, { method: 'thread/compacted', params: { threadId: thread.id } }), 500);
    return {};
  }
  if (input.operation === 'imagePreview' || input.operation === 'imageChunk') return demoImageResponse(input);
  if (input.operation === 'archive') { archived.add(thread.id); return {}; }
  if (input.operation === 'unarchive') { archived.delete(thread.id); return {}; }
  if (input.operation === 'send') { startTurn(thread, String(input.text), link); return {}; }
  const turn = thread.turns?.find((entry) => entry.id === input.turnId);
  if (input.operation === 'interrupt' && turn) {
    finish({ thread, turn, link }, 'interrupted');
    return {};
  }
  if (input.operation === 'steer' && turn) {
    const item: Item = { id: uniqueId('steer'), type: 'userMessage',
      content: [{ type: 'text', text: String(input.text) }] };
    turn.items.push(item);
    notify(link, { method: 'item/completed', params: { threadId: thread.id, turnId: turn.id, item } });
  }
  return {};
}

function notify(link: DemoLink, event: GuiEvent) {
  guiSidebar.receive(event);
  const prepared = images.prepare(historyNotification(event), event.params.threadId ?? event.params.thread?.id ?? '');
  void (sidebarLink ?? link).send({ kind: 'event', event: structuredClone(prepared) }).catch((error: unknown) => {
    streamErrors.push(error instanceof Error ? error.message : 'Could not send demo event');
  });
}

function startTurn(thread: Thread, text: string, link: DemoLink) {
  const turn: Turn = { id: uniqueId('turn'), status: 'inProgress', startedAt: Date.now() / 1000, items: [
    { id: uniqueId('user'), type: 'userMessage', content: [{ type: 'text', text }] },
  ] };
  thread.turns?.push(turn);
  thread.status = { type: 'active' };
  thread.preview = text;
  notify(link, { method: 'turn/started', params: { threadId: thread.id, turn } });
  if (text.includes('approval') || text.includes('question')) requestApproval({ thread, turn, link }, text);
  else if (text.includes('image preview')) previewTurn({ thread, turn, link }, text);
  else void stream({ thread, turn, link }, text.includes('slow'));
  return turn;
}

interface Context { thread: Thread; turn: Turn; link: DemoLink }

function previewTurn(context: Context, text: string) {
  const endpoint = new URL(new URLSearchParams(location.search).get('socket') ?? 'ws://127.0.0.1:1490');
  endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
  const local = text.includes('remote image preview') ? '' : '![本地图片](./preview.png)\n\n';
  const remote = text.includes('local image preview') ? ''
    : `![网络图片](${endpoint.origin}/test/preview.png)\n\n`;
  const item: Item = { id: uniqueId('image'), type: 'agentMessage', text: '图片前的文字。\n\n'
    + local + remote + '图片后的文字。' };
  context.turn.items.push(item);
  notify(context.link, { method: 'item/completed',
    params: { threadId: context.thread.id, turnId: context.turn.id, item } });
  finish(context);
}

function finish(context: Context, status = 'completed') {
  context.turn.status = status;
  context.thread.status = { type: 'idle' };
  notify(context.link, { method: 'turn/completed', params: { threadId: context.thread.id, turn: context.turn } });
  flushDemoQueue(queueHost(context.thread, context.link));
}

function queueHost(thread: Thread, link: DemoLink) {
  const execute = (input: Record<string, unknown>) => {
    operations.push(input);
    threadOperation(thread, input, link);
  };
  return { thread, link: sidebarLink ?? link,
    send: (input: Record<string, unknown>) => execute({ ...input, operation: 'send' }),
    steer: (input: Record<string, unknown>) => execute({ ...input, operation: 'steer' }) };
}

export function changeDemoSidebar(action: string, link: DemoLink) {
  configureDownloadFixture(action);
  sidebarLink = link;
  if (action === 'context-usage') {
    const tokens = { totalTokens: 14550, inputTokens: 14000, cachedInputTokens: 0,
      outputTokens: 550, reasoningOutputTokens: 0 };
    welcome.tokenUsage = { total: tokens, last: tokens, modelContextWindow: 258400 };
    notify(link, { method: 'thread/tokenUsage/updated',
      params: { threadId: welcome.id, tokenUsage: welcome.tokenUsage } });
  }
  if (action === 'group-preview') seedThreadGroups(link);
  if (action === 'history-pages') seedDemoHistory(welcome);
  if (action === 'history-compact') seedDemoCompactHistory(welcome);
  if (action === 'history-opening') seedDemoOpeningHistory(welcome);
  if (action === 'history-empty') welcome.turns = [];
  if (action === 'history-footer') seedDemoFooterHistory(welcome);
  if (action === 'message-details') seedDemoDetails(welcome);
  if (action === 'video-preview') seedDemoVideo(welcome);
  if (action === 'web-parity') seedChatParity(welcome);
  if (action === 'downloads') seedDownloads(welcome);
  if (action === 'async-parity') seedAsyncQuestion(welcome);
  if (action === 'async-layout') seedAsyncQuestion(welcome, [{ options: null,
    title: '请描述出现问题的页面、当时的操作以及是否打开了键盘，方便确认抽屉在不同内容高度下的位置是否保持稳定。',
  }]);
  if (action === 'start' && welcome.turns?.some((turn) => turn.status === 'inProgress')) {
    throw new Error('Wait for the current demo turn before starting a background turn');
  }
  if (action === 'start') startTurn(welcome, 'slow task', link);
  const turn = welcome.turns?.at(-1);
  if (action === 'complete' && turn) finish({ thread: welcome, turn, link });
  if (action === 'read' && turn) guiSidebar.markRead({ threadId: welcome.id, turnId: turn.id });
  return guiSidebar.observe([...threads.values()]);
}

function seedThreadGroups(link: DemoLink) {
  saveProject({ path: 'F:/projects/five', name: '五条项目' });
  for (const group of [
    { cwd: welcome.cwd, title: '项目聊天' }, { cwd: '', title: '最近聊天' },
    { cwd: 'F:/projects/five', title: '五条聊天' },
  ]) {
    for (let index = 1; index <= 5; index++) {
      const thread: Thread = { id: uniqueId('group'), name: `${group.title} ${index}`, cwd: group.cwd,
        preview: '', updatedAt: Math.floor(Date.now() / 1000), turns: [] };
      threads.set(thread.id, thread);
      notify(link, { method: 'thread/started', params: { thread } });
    }
  }
}

async function stream(context: Context, slow: boolean) {
  const { thread, turn, link } = context;
  const item: Item = { id: uniqueId('response'), type: 'agentMessage', text: '' };
  turn.items.push(item);
  notify(link, { method: 'item/started', params: { threadId: thread.id, turnId: turn.id, item } });
  const parts = ['已经收到你的消息。', '\n\n手机和电脑正在同步。', '\n\n```typescript\n',
    'const connected = true;\n', '```\n', '\n这条回复用于验证实际移动端的收发和显示。'];
  for (const delta of slow ? Array.from({ length: 60 }, () => '处理中…\n') : parts) {
    if (turn.status !== 'inProgress') return;
    item.text += delta;
    notify(link, { method: 'item/agentMessage/delta', params: { threadId: thread.id, turnId: turn.id,
      itemId: item.id, delta } });
    await new Promise((resolve) => setTimeout(resolve, slow ? 1000 : 450));
  }
  finish(context);
}

function requestApproval(context: Context, text: string) {
  const id = uniqueId('approval');
  const question = text.includes('question');
  const event: GuiEvent = { id,
    method: question ? 'item/tool/requestUserInput' : 'item/commandExecution/requestApproval',
    params: { threadId: context.thread.id, turnId: context.turn.id, reason: '用于验证手机上的确认流程。',
      ...(question ? { questions: [{ id: 'choice', header: '选择', question: '请选择下一步', options: [
        { label: '继续验证', description: '检查手机和电脑的同步' }, { label: '稍后处理', description: '暂时结束本次验证' },
      ] }] } : { command: 'npm test', availableDecisions: ['accept', 'decline'] }) } };
  approvals.set(id, { ...context, event });
  notify(context.link, event);
}

function respond(input: Record<string, unknown>) {
  const pending = approvals.get(String(input.id));
  if (!pending) throw new Error('Unknown demo approval');
  approvals.delete(String(input.id));
  notify(pending.link, { method: 'serverRequest/resolved', params: { requestId: String(input.id) } });
  finish(pending, input.decision === 'decline' ? 'interrupted' : 'completed');
  return {};
}
