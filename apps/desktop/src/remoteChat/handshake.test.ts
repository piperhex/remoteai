// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../pages/codexGui/api';
import { chatApprovals, chatHandshake } from '../../../../shared/remote-chat/handshake';
import { CONNECTION_ERRORS } from '../../../../shared/remote-chat/connectionErrors';
import { ChatRpc } from '../../../../shared/remote-chat/rpc';
import { REQUEST_TIMEOUT_MS } from '../../../../shared/remote-chat/protocol';

vi.mock('../pages/codexGui/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

it.each([undefined, chatHandshake])('connects compatible phones and preserves pending approvals', async (body) => {
  const approvals = [{ method: 'approval', params: {}, id: 1 }];
  vi.mocked(guiApi.connect).mockResolvedValue(approvals);
  const result = await new ChatOperations().execute({ kind: 'request', id: 'connect', method: 'connect', body });
  expect(result.error).toBeUndefined();
  expect(chatApprovals(result.data)).toEqual(approvals);
  expect(guiApi.connect).toHaveBeenCalledWith({ reuseExisting: true });
  if (body) expect(result.data).toEqual({ ...chatHandshake, fileBulkV1: true, approvals });
  else expect(result.data).toEqual(approvals);
});

it.each([{ protocolVersion: 2 }, { protocolVersion: '1' }, null, {}])(
  'rejects incompatible or malformed handshakes before starting Codex', async (body) => {
    const result = await new ChatOperations().execute({ kind: 'request', id: 'connect', method: 'connect', body });
    expect(result.error).toBe(CONNECTION_ERRORS.incompatible);
    expect(guiApi.connect).not.toHaveBeenCalled();
  },
);

it('rejects incompatible PC replies but accepts legacy approval lists', () => {
  expect(() => chatApprovals({ protocolVersion: 2, approvals: [] })).toThrow(CONNECTION_ERRORS.incompatible);
  expect(() => chatApprovals({ ...chatHandshake, approvals: null })).toThrow(CONNECTION_ERRORS.invalid);
  expect(chatApprovals([])).toEqual([]);
});

it.each([
  ['请先下载 Codex，即可开始对话。', CONNECTION_ERRORS.missingGui],
  ['Codex 暂时无法启动，请检查 Codex 配置后重试。', CONNECTION_ERRORS.startup],
  ['Codex 响应超时，请检查连接状态。', CONNECTION_ERRORS.guiTimeout],
  ['Codex 已断开连接，请重新连接后继续。', CONNECTION_ERRORS.guiDisconnected],
  ['暂时无法准备对话，请稍后重试。', CONNECTION_ERRORS.workspace],
  [new Error('spawn C:/private/user/codex.exe token=secret'), CONNECTION_ERRORS.gui],
])('explains GUI failures without exposing internal details', async (failure, message) => {
  vi.mocked(guiApi.connect).mockRejectedValue(failure);
  const result = await new ChatOperations().execute({ kind: 'request', id: 'connect', method: 'connect' });
  expect(result.error).toBe(message);
});

it('gives initialization timeouts a connection-specific recovery action', async () => {
  vi.useFakeTimers();
  const rpc = new ChatRpc({ prefix: 'test', send: async () => {}, event: () => {} });
  const result = expect(rpc.request('connect', chatHandshake)).rejects.toThrow(CONNECTION_ERRORS.guiTimeout);
  await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
  await result;
  rpc.close();
  expect(vi.getTimerCount()).toBe(0);
});
