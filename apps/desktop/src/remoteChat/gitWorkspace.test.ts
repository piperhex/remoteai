// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { invoke } from '../api/backend';
import { createGuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { ChatRpc } from '../../../../shared/remote-chat/rpc';
import type { GitRequest, GitStatus } from '../../../../shared/remote-chat/gitWorkspace';
import type { RpcMessage } from '../../../../shared/remote-chat/protocol';

const host = vi.hoisted(() => ({ sending: false, workspaceBusy: false }));
vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: () => ({
  getSnapshot: () => host, setWorkspaceBusy: (busy: boolean) => { host.workspaceBusy = busy; },
}) }));

const status: GitStatus = { cwd: '/remote/project', branch: 'main', branches: [],
  isWorktree: false, changedFiles: 0 };
const envelope = (request: GitRequest, id = 'workspace') => ({ kind: 'request' as const,
  method: 'request' as const, id, body: { operation: 'guiGitWorkspace', request } });

beforeEach(() => { vi.resetAllMocks(); host.sending = false; host.workspaceBusy = false; });
afterEach(() => vi.useRealTimers());

it.each<GitRequest>([
  { operation: 'status', cwd: status.cwd },
  { operation: 'switch', cwd: status.cwd, branch: 'feature/login', create: true },
  { operation: 'switch', cwd: status.cwd, branch: 'develop', create: false },
  { operation: 'createWorktree', cwd: status.cwd, branch: 'parallel' },
])('routes $operation through the selected host Git command', async input => {
  vi.mocked(invoke).mockResolvedValue(status);
  const operations = new ChatOperations();
  const client = createGuiToolsClient(async <T>(body: object) => {
    const result = await operations.execute({ ...envelope(input), body }, 'relay', 'account');
    if (result.error) throw new Error(result.error);
    return result.data as T;
  });
  expect(await client.workspace(input)).toEqual(status);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('codex_gui_git', { request: input });
  expect(host.workspaceBusy).toBe(false);
});

it('deduplicates retries and prevents overlapping host mutations until Git finishes', async () => {
  let finish!: (value: GitStatus) => void;
  vi.mocked(invoke).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const operations = new ChatOperations();
  const request = envelope({ operation: 'createWorktree', cwd: status.cwd, branch: 'parallel' });
  const pending = operations.execute(request, 'relay', 'account');
  const retry = operations.execute(request, 'direct', 'account');
  expect(host.workspaceBusy).toBe(true);
  const overlapping = await operations.execute({ ...request, id: 'other' }, 'relay', 'account');
  expect(overlapping.error).toContain('项目正在处理中');
  expect(invoke).toHaveBeenCalledOnce();
  finish({ ...status, cwd: '/remote/worktree', isWorktree: true });
  expect((await pending).data).toEqual((await retry).data);
  expect(host.workspaceBusy).toBe(false);
});

it('unlocks after failures, preserves safe errors, and rejects operations outside the workspace API', async () => {
  const operations = new ChatOperations();
  vi.mocked(invoke).mockRejectedValue('无法切换分支。请检查未提交的修改。');
  const request = envelope({ operation: 'switch', cwd: status.cwd, branch: 'next', create: false });
  expect((await operations.execute(request)).error).toContain('请检查未提交的修改');
  expect(host.workspaceBusy).toBe(false);
  const invalid = { ...request, id: 'invalid', body: {
    operation: 'guiGitWorkspace', request: { operation: 'reset', cwd: status.cwd },
  } };
  expect((await operations.execute(invalid)).error).toContain('操作无效');
  host.sending = true;
  expect((await operations.execute({ ...request, id: 'sending' })).error).toContain('项目正在处理中');
  expect(invoke).toHaveBeenCalledOnce();
});

it('allows a large worktree checkout to finish beyond the normal RPC deadline', async () => {
  vi.useFakeTimers();
  const sent: RpcMessage[] = [];
  const rpc = new ChatRpc({ prefix: 'workspace', send: async value => { sent.push(value); }, event() {} });
  const pending = rpc.request('request', envelope({ operation: 'createWorktree',
    cwd: status.cwd, branch: 'parallel' }).body);
  await vi.advanceTimersByTimeAsync(120_000);
  rpc.receive({ kind: 'response', id: (sent[0] as { id: string }).id, data: status });
  expect(await pending).toEqual(status);
  rpc.close();
});
