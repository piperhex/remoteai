// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import type { ChatConnection } from '../../../../../../shared/remote-chat/client/connection';
import type { GitRequest, GitStatus } from '../../../../../../shared/remote-chat/gitWorkspace';
import { RemoteGuiProject } from './RemoteGuiProject';
import type { GuiComputerNavigation } from './types';
import { gitApi } from '../gitApi';

vi.mock('../gitApi', () => ({ gitApi: { request: vi.fn() } }));
vi.mock('../GuiHostPicker', () => ({ GuiHostPicker: () => <span>测试电脑</span> }));
const navigation: GuiComputerNavigation = { current: null, devices: [], authenticated: true,
  loading: false, error: '', refresh() {}, choose() {}, login() {} };
const original: GitStatus = { cwd: '/remote/project', branch: 'develop', isWorktree: false, changedFiles: 1,
  branches: [{ name: 'develop', occupied: false }, { name: 'feature', occupied: false },
    { name: 'occupied', occupied: true }] };
let root: Root;
let container: HTMLDivElement;
let controller: ChatController;
let status: GitStatus;
const request = vi.fn<ChatConnection['request']>();

function Harness({ active = true }: { active?: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <RemoteGuiProject state={state} controller={controller} computers={navigation} active={active} />;
}
const render = (active = true) => act(async () => root.render(<Harness active={active} />));
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  .find(element => element.getAttribute('aria-label') === label || element.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
async function branchName(name: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="新分支名称"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  const computedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => computedStyle(element));
  status = original;
  request.mockReset().mockImplementation(async (_method, body) => {
    const input = (body as { request: GitRequest }).request;
    if (input.operation === 'switch') status = { ...status, branch: input.branch };
    if (input.operation === 'createWorktree') {
      status = { ...status, branch: input.branch, cwd: '/remote/worktrees/new', isWorktree: true };
    }
    return status;
  });
  controller = new ChatController(() => ({ start() {}, stop() {},
    request: <T,>(...args: Parameters<ChatConnection['request']>) => request(...args) as Promise<T>,
  }));
  Object.assign(controller.snapshot(), { ready: true, draftProject: { cwd: status.cwd, label: '项目' } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  controller.stop(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

it('shows the same workspace controls, loads remote branches and switches without invoking local Git', async () => {
  await render();
  expect(button('工作位置').textContent).toContain('工作树');
  expect(button('切换 Git 分支').textContent).toContain('develop');
  await click('切换 Git 分支');
  const occupied = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    .find(element => element.textContent?.includes('occupied'))!;
  expect(occupied.disabled).toBe(true);
  await click('feature');
  expect(button('切换 Git 分支').textContent).toContain('feature');
  expect(request).toHaveBeenLastCalledWith('request', { operation: 'guiGitWorkspace', request: {
    operation: 'switch', cwd: original.cwd, branch: 'feature', create: false,
  } });
  expect(gitApi.request).not.toHaveBeenCalled();
});

it('creates a remote worktree and uses its directory for the next conversation', async () => {
  await render(); await click('工作位置'); await click('新建远程工作树');
  await branchName('parallel');
  await click('创建工作树');
  expect(controller.snapshot().draftProject?.cwd).toBe('/remote/worktrees/new');
  expect(button('工作位置').textContent).toContain('远程工作树');
  expect(button('切换 Git 分支').textContent).toContain('parallel');
  expect(controller.snapshot().workspaceBusy).toBe(false);
});

it('creates a branch in the selected remote project', async () => {
  await render(); await click('切换 Git 分支'); await click('创建并切换新分支…');
  await branchName('feature/new'); await click('创建并切换');
  expect(button('切换 Git 分支').textContent).toContain('feature/new');
  expect(controller.snapshot().draftProject?.cwd).toBe(original.cwd);
  expect(request).toHaveBeenLastCalledWith('request', { operation: 'guiGitWorkspace', request: {
    operation: 'switch', cwd: original.cwd, branch: 'feature/new', create: true,
  } });
});

it('keeps a completed remote worktree when the connection is still synchronizing', async () => {
  await render(); await click('工作位置'); await click('新建远程工作树'); await branchName('parallel');
  let finish!: (value: GitStatus) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await click('创建工作树');
  Object.assign(controller.snapshot(), { ready: false });
  await render();
  await act(async () => finish({ ...original, cwd: '/remote/worktrees/new', isWorktree: true }));
  expect(controller.snapshot().draftProject?.cwd).toBe('/remote/worktrees/new');
  expect(controller.snapshot().workspaceBusy).toBe(false);
});

it('blocks sending during a checkout and leaves the original project selected after failure', async () => {
  await render(); await click('切换 Git 分支');
  let fail!: (error: Error) => void;
  request.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await click('feature');
  expect(controller.snapshot().workspaceBusy).toBe(true);
  expect(button('选择远程项目').disabled).toBe(true);
  const calls = request.mock.calls.length;
  expect(await controller.send({ text: 'test', access: 'workspace-write' })).toBe(false);
  expect(await controller.goals.start({ text: 'test goal', access: 'workspace-write' })).toBe(false);
  expect(request).toHaveBeenCalledTimes(calls);
  await act(async () => fail(new Error('请检查未提交的修改。')));
  expect(controller.snapshot().draftProject?.cwd).toBe(original.cwd);
  expect(button('切换 Git 分支').textContent).toContain('develop');
  expect(controller.snapshot().workspaceBusy).toBe(false);
  expect(document.body.textContent).toContain('请检查未提交的修改。');
});

it('waits for an active connection and keeps workspace changes outside existing conversations', async () => {
  Object.assign(controller.snapshot(), { ready: false });
  await render(); expect(request).not.toHaveBeenCalled();
  expect(button('切换 Git 分支').disabled).toBe(true);
  Object.assign(controller.snapshot(), { ready: true });
  await render(false); expect(request).not.toHaveBeenCalled();
  await render(); expect(request).toHaveBeenCalledOnce();
  Object.assign(controller.snapshot(), { selected: { id: 'existing', cwd: original.cwd } });
  await render(); expect(button('切换 Git 分支')).toBeUndefined();
});
