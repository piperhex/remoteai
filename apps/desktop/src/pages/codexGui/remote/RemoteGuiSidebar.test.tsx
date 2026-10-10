// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { App, ConfigProvider } from 'antd';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import type { ChatConnection } from '../../../../../../shared/remote-chat/client/connection';
import type { ChatState } from '../../../../../../shared/remote-chat/client/types';
import { RemoteGuiSidebar } from './RemoteGuiSidebar';
import styles from '../styles.module.less';
import { historyDelta } from '../../../../../../shared/remote-chat/historySync';

let root: Root;
let container: HTMLDivElement;
let controller: ChatController;
const request = vi.fn<ChatConnection['request']>();
const thread = { id: 'current', cwd: 'D:/project', name: '已有对话', preview: '', updatedAt: 1 };
const older = { ...thread, id: 'older', name: '更早的对话' };
const actions = { newChat: vi.fn(), onClose: vi.fn(), openSearch: vi.fn() };

function Harness() {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <RemoteGuiSidebar state={state} controller={controller} actions={actions} accountPicker={null}
    focusMode={{ focused: false, onToggleFocus: vi.fn() }} />;
}
const render = () => act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
  <App><Harness /></App></ConfigProvider>));
const list = () => container.querySelector<HTMLDivElement>(`.${styles.threadList}`)!;
const footer = () => container.querySelector('[role="status"]');
const wheel = (deltaY = 50) => act(async () => {
  list().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
});
const scroll = (top: number) => act(async () => {
  list().scrollTop = top;
  list().dispatchEvent(new Event('scroll', { bubbles: true }));
});
function dimensions(height = 1000) {
  Object.defineProperties(list(), {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: height },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => original(element));
  request.mockReset().mockResolvedValue({ data: [older], nextCursor: null });
  controller = new ChatController(() => ({ start() {}, stop() {},
    request: <T,>(...args: Parameters<ChatConnection['request']>) => request(...args) as Promise<T>,
  }));
  Object.assign(controller.snapshot(), { ready: true, cursor: 'next', threads: [thread] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  controller.stop(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('keeps remote chats usable during background sync and joins a manual refresh to the same request', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  let background!: Promise<void>;
  await act(async () => { background = controller.list({ background: true }); });
  const refresh = container.querySelector<HTMLButtonElement>('[aria-label="刷新对话"]')!;
  expect(refresh.classList.contains('ant-btn-loading')).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="已有对话"]')!.disabled).toBe(false);
  expect(list().getAttribute('aria-busy')).toBe('true');
  let manual!: Promise<void>;
  await act(async () => { manual = controller.list(); });
  expect(manual).toBe(background);
  expect(request).toHaveBeenCalledTimes(1);
  expect(refresh.classList.contains('ant-btn-loading')).toBe(true);
  await act(async () => {
    finish({ data: [older], nextCursor: null });
    await manual;
  });
  expect(refresh.classList.contains('ant-btn-loading')).toBe(false);
  expect(refresh.disabled).toBe(false);
  expect(list().textContent).toContain('更早的对话');
});

it('retries the failed remote page on downward scrolling with the local hint and no overlapping requests', async () => {
  request.mockRejectedValueOnce(new Error('连接暂时中断'));
  await render(); dimensions();
  expect(request).not.toHaveBeenCalled();
  await scroll(200);
  expect(request).not.toHaveBeenCalled();
  await scroll(490);
  expect(request).toHaveBeenCalledExactlyOnceWith('request', {
    operation: 'list', search: '', archived: false, cursor: 'next',
  });
  expect(container.textContent).toContain('已有对话');
  expect(container.textContent).not.toContain('加载失败，点击重试');
  expect(footer()?.textContent).toBe('向下滚动，查看更多');
  expect(footer()?.querySelector('button')).toBeNull();
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await wheel();
  expect(footer()?.textContent).toBe('正在加载更多对话…');
  await wheel(); await scroll(520);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  await act(async () => finish({ data: [older], nextCursor: null }));
  expect(container.textContent).toContain('已有对话');
  expect(container.textContent).toContain('更早的对话');
  expect(footer()).toBeNull();
  await wheel();
  expect(request).toHaveBeenCalledTimes(2);
});

it('loads archived conversations with the wheel when collapsed groups leave no scrollable overflow', async () => {
  Object.assign(controller.snapshot(), { archived: true });
  await render(); dimensions(400);
  const group = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  await act(async () => group.click());
  expect(group.getAttribute('aria-expanded')).toBe('false');
  expect(request).not.toHaveBeenCalled();
  await wheel();
  expect(request).toHaveBeenCalledExactlyOnceWith('request', {
    operation: 'list', search: '', archived: true, cursor: 'next',
  });
});

it.each<Partial<ChatState>>([{ ready: false }, { loading: true }, { cursor: null }])(
  'pauses pagination when unavailable: %j', async patch => {
    Object.assign(controller.snapshot(), patch);
    await render(); dimensions();
    await scroll(500); await wheel();
    expect(request).not.toHaveBeenCalled();
  },
);

it('ignores upward gestures and downward gestures away from the bottom', async () => {
  await render(); dimensions();
  await wheel();
  list().scrollTop = 600;
  await wheel(-50);
  expect(request).not.toHaveBeenCalled();
});

const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
  .find(entry => entry.textContent?.replace(/\s/g, '') === label)!;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  .find(entry => entry.textContent === label)!;
const openMenu = () => act(async () => {
  button('已有对话').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
});

it('opens a compact context menu without selecting the source and creates the remote branch', async () => {
  const fork = { ...thread, id: 'fork', name: '新分支', turns: [] };
  request.mockImplementation(async (_method, body) => {
    const input = body as { operation: string };
    if (input.operation === 'forkLatest') return { thread: fork };
    if (input.operation === 'syncHistory') return historyDelta(fork);
    return { data: [thread, fork], nextCursor: null };
  });
  await render(); await openMenu();
  expect(controller.snapshot().selected).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect([...document.querySelectorAll('[role="menuitem"]')].map(entry => entry.textContent))
    .toEqual(['置顶', '重命名', '创建分支', '归档', '删除']);
  expect(document.querySelector<HTMLElement>('.ant-dropdown')!.style.maxWidth).toBe('400px');
  await act(async () => menuItem('创建分支').click());
  expect(request).toHaveBeenCalledWith('request', { operation: 'forkLatest', threadId: thread.id });
  expect(controller.snapshot().selected?.id).toBe('fork');
  expect(actions.onClose).toHaveBeenCalledOnce();
});

it.each(['rename', 'delete'] as const)('confirms %s in a compact dialog and sends the clicked id', async action => {
  const run = vi.spyOn(controller.threadActions, 'run').mockResolvedValue();
  await render(); await openMenu();
  await act(async () => menuItem(action === 'rename' ? '重命名' : '删除').click());
  expect(run).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLElement>('[role="dialog"]')!.style.width).toBe('400px');
  if (action === 'rename') expect(document.querySelector<HTMLInputElement>('input[aria-label="对话名称"]')!.value)
    .toBe('已有对话');
  await act(async () => button(action === 'rename' ? '保存' : '移入回收站').click());
  expect(run).toHaveBeenCalledWith(thread, action, '已有对话');
});

it.each(['pin', 'unpin', 'archive', 'unarchive'] as const)('runs %s from the remote context menu', async action => {
  const run = vi.spyOn(controller.threadActions, 'run').mockResolvedValue();
  Object.assign(controller.snapshot(), { archived: action === 'unarchive' });
  if (action === 'unpin') controller.snapshot().sidebar.pins = [thread.id];
  const labels = { pin: '置顶', unpin: '取消置顶', archive: '归档', unarchive: '恢复对话' };
  await render(); await openMenu();
  await act(async () => menuItem(labels[action]).click());
  expect(run).toHaveBeenCalledExactlyOnceWith(thread, action);
});

it.each<Partial<ChatState>>([{ ready: false }, { threadActionBusy: 'other' }, { archived: true },
  { threads: [{ ...thread, status: { type: 'active' } }] }])('blocks unavailable branches: %j', async patch => {
  Object.assign(controller.snapshot(), patch);
  await render(); await openMenu();
  expect(menuItem('创建分支').getAttribute('aria-disabled')).toBe('true');
  await act(async () => menuItem('创建分支').click());
  expect(request).not.toHaveBeenCalled();
});
