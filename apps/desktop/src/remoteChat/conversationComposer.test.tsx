// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatComposer } from '../../../web/src/chat/ChatComposer';
import type { ComposerProps } from '../../../web/src/chat/composerProps';
import { guiApi } from '../pages/codexGui/api';
import type { ListResponse, Thread } from '../../../../shared/remote-chat/client/types';

vi.mock('../pages/codexGui/api', () => ({ guiApi: { request: vi.fn() } }));
const threads: Thread[] = [
  { id: 'current', name: '当前对话', preview: '', cwd: '/remote/project', updatedAt: 3 },
  { id: 'design', name: '远程设计讨论', preview: '', cwd: '/remote/design', updatedAt: 2 },
  { id: 'build', name: '远程构建', preview: '', cwd: '/remote/build', updatedAt: 1, status: { type: 'active' } },
];
let host: HTMLDivElement;
let root: Root;
let props: ComposerProps;

beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { connection: { deviceName: '远程电脑', chooseDevice: vi.fn(), client: {
    read: vi.fn(), select: vi.fn(), subscribe: vi.fn(() => vi.fn()),
  } }, models: [], selection: { model: 'astra', effort: 'high', access: 'workspace-write' },
    contextSettings: { read: vi.fn(), write: vi.fn() }, readUsage: vi.fn(),
    readConversationMetrics: vi.fn(),
    goals: { load: vi.fn(), clear: vi.fn() }, goalBusy: false,
    catalog: { skills: [], loaded: true, loading: false, error: '', refresh: vi.fn() }, cwd: '/remote/project',
    compactReason: null, compacting: false, compact: vi.fn(), loadFiles: vi.fn(),
    loadCatalog: vi.fn().mockResolvedValue({ data: [], plugins: [
      { id: 'github', name: 'GitHub', installed: true, enabled: true },
    ] }), loadConversations: vi.fn().mockResolvedValue({ data: threads, nextCursor: null }),
    settingsBusy: false, settingsError: '', updateSettings: vi.fn(), active: true, ready: true,
    sending: false, running: false, threadId: 'current', send: vi.fn().mockResolvedValue(true), interrupt: vi.fn() };
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function render(update: Partial<ComposerProps> = {}) {
  props = { ...props, ...update };
  await act(async () => root.render(<ChatComposer {...props} />));
}
const input = () => host.querySelector('textarea')!;
const options = () => [...host.querySelectorAll<HTMLButtonElement>('.chat-conversation-menu [role="menuitem"]')];
async function type(text: string) {
  await act(async () => {
    const node = input();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, text);
    node.setSelectionRange(text.length, text.length);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
}
const key = (value: string) => act(async () => {
  input().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
});

it('excludes the current conversation, selects without sending and sends the remote reference', async () => {
  await type('@');
  expect(options().map(option => option.textContent)).toEqual([
    '远程构建运行中 · /remote/build', '远程设计讨论空闲 · /remote/design',
  ]);
  expect(props.loadConversations).toHaveBeenCalledExactlyOnceWith({ search: '', archived: false, limit: 50 });
  expect(guiApi.request).not.toHaveBeenCalled();
  expect(props.catalog.refresh).not.toHaveBeenCalled();
  expect(props.loadCatalog).not.toHaveBeenCalled();
  await key('ArrowDown'); await key('Enter');
  expect(props.send).not.toHaveBeenCalled();
  expect(input().value).toBe('');
  expect(host.querySelector('.chat-capsule')?.textContent).toBe('@远程设计讨论');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="发送消息"]')!.click());
  expect(props.send).toHaveBeenCalledWith({ text: '', images: [], ...props.selection,
    attachments: [{ kind: 'conversation', name: '远程设计讨论', path: 'codex-thread://design' }] });
  expect(host.querySelector('.chat-capsule')).toBeNull();
});

it('searches names, selects with Tab and keeps plugin selection available through the add menu', async () => {
  await type('someone@example.com');
  expect(props.loadConversations).not.toHaveBeenCalled();
  await type('@设计');
  expect(props.loadConversations).toHaveBeenLastCalledWith({ search: '设计', archived: false, limit: 50 });
  expect(options()).toHaveLength(1);
  await key('Tab');
  expect(host.querySelector('.chat-capsule')?.textContent).toBe('@远程设计讨论');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="添加内容"]')!.click());
  const plugins = [...host.querySelectorAll<HTMLButtonElement>('.chat-add-menu button')]
    .find(button => button.textContent === '插件')!;
  await act(async () => plugins.click());
  expect(input().value).toBe('');
  expect(host.querySelector('[aria-label="插件列表"]')).not.toBeNull();
  await key('Enter');
  expect(host.querySelector('[aria-label="移除GitHub"]')).not.toBeNull();
  expect(props.send).not.toHaveBeenCalled();
});

it('keeps polling single flight and ignores pending results after switching conversations', async () => {
  let resolve!: (value: ListResponse<Thread>) => void;
  const load = vi.fn(() => new Promise<ListResponse<Thread>>(finish => { resolve = finish; }));
  vi.mocked(props.loadConversations!).mockImplementation(load);
  await type('@');
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(load).toHaveBeenCalledOnce();
  await render({ threadId: 'other' });
  await act(async () => resolve({ data: threads, nextCursor: null }));
  expect(host.querySelector('.chat-composer-popover')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(load).toHaveBeenCalledOnce();
});

it('preserves a pending conversation query when choosing a plugin from the add menu', async () => {
  await type('参考 @设计');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="添加内容"]')!.click());
  const plugins = [...host.querySelectorAll<HTMLButtonElement>('.chat-add-menu button')]
    .find(button => button.textContent === '插件')!;
  await act(async () => plugins.click());
  expect(host.querySelector('[aria-label="插件列表"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="对话"]')).toBeNull();
  expect(input().value).toBe('参考 @设计');
  await key('Enter');
  expect(host.querySelector('[aria-label="移除GitHub"]')).not.toBeNull();
  expect(input().value).toBe('参考 @设计');
  expect(props.send).not.toHaveBeenCalled();
});

it('does not submit an empty or failed search and stops polling when hidden or disconnected', async () => {
  vi.mocked(props.loadConversations!).mockRejectedValue(new Error('offline'));
  await type('@');
  expect(host.textContent).toContain('对话加载失败');
  await key('Enter'); expect(props.send).not.toHaveBeenCalled();
  await key('Escape'); expect(host.querySelector('.chat-composer-popover')).toBeNull();
  vi.mocked(props.loadConversations!).mockResolvedValue({ data: [], nextCursor: null });
  await type('@missing');
  expect(host.textContent).toContain('没有找到可引用的对话');
  await key('Enter'); expect(props.send).not.toHaveBeenCalled();
  await render({ ready: false });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(props.loadConversations).toHaveBeenCalledTimes(2);
  await render({ active: false });
  expect(host.querySelector('.chat-composer-popover')).toBeNull();
});
