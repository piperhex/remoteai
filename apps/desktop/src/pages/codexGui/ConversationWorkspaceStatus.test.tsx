// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationWorkspaceStatus } from '../../../../../shared/conversation/ConversationWorkspaceStatus';
import type { GitStatus, GitWorkspaceClient } from '../../../../../shared/conversation/gitApi';

const initial: GitStatus = { cwd: '/projects/app', branch: 'main', branches: [],
  changedFiles: 0, isWorktree: false };
let container: HTMLDivElement;
let root: Root;
const request = vi.fn<GitWorkspaceClient>();
const render = (cwd = initial.cwd, enabled = true) => act(async () => {
  root.render(<ConversationWorkspaceStatus cwd={cwd} enabled={enabled} request={request} />);
});
const branch = () => container.querySelector('[aria-label="当前分支"]')?.textContent;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  request.mockReset().mockResolvedValue(initial);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('keeps reading the current branch without overlapping requests or making mutations', async () => {
  let finish!: (status: GitStatus) => void;
  request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); window.dispatchEvent(new Event('focus')); });
  expect(request).toHaveBeenCalledOnce();
  await act(async () => finish(initial));
  expect(branch()).toBe('main');
  request.mockResolvedValue({ ...initial, branch: 'feature/live' });
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(branch()).toBe('feature/live');
  expect(request.mock.calls.every(([input]) => input.operation === 'status')).toBe(true);
});

it('discards an old directory response after switching conversations', async () => {
  let finish!: (status: GitStatus) => void;
  request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render();
  request.mockResolvedValue({ ...initial, cwd: '/trees/parallel', branch: 'parallel', isWorktree: true });
  await render('/trees/parallel');
  await act(async () => finish(initial));
  expect(branch()).toBe('parallel');
  expect(container.textContent).toContain('工作树：parallel');
});

it('clears stale Git information on failure and handles detached HEAD', async () => {
  await render();
  request.mockRejectedValueOnce(new Error('Not a repository'));
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(branch()).toBe('暂不可用');
  request.mockResolvedValue({ ...initial, branch: null });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(branch()).toBe('分离的 HEAD');
});

it('stops refreshing when inactive, disconnected or unmounted and resumes on activation', async () => {
  await render(initial.cwd, false);
  expect(request).not.toHaveBeenCalled();
  await render();
  await render(initial.cwd, false);
  const calls = request.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); window.dispatchEvent(new Event('focus')); });
  expect(request).toHaveBeenCalledTimes(calls);
  await render();
  expect(request).toHaveBeenCalledTimes(calls + 1);
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(request).toHaveBeenCalledTimes(calls + 1);
});
