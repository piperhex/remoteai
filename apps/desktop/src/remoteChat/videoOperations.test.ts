// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_POLICY, MIB, setChatPolicy, videoByteLimit } from '../../../../shared/remote-chat/policy';
import { ChatOperations } from './operations';
import { guiApi } from '../../../../shared/conversation/api';
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn(), connect: vi.fn() } }));
afterEach(() => { setChatPolicy(DEFAULT_CHAT_POLICY); vi.resetAllMocks(); });
it('uses admin video limits instead of client values and reapplies changes on repeatable reads', async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ offset: 0, data: 'AAAA' });
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, method: 'request' as const, id: 'video:1',
    body: { operation: 'videoRead', threadId: 'thread', id: 'session', offset: 0, length: 3, maxBytes: 999999999 } };
  await operations.execute(request);
  expect(guiApi.request).toHaveBeenLastCalledWith({ ...request.body, maxBytes: 100 * MIB });
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, videoPreviewMaxMb: 1 });
  await operations.execute(request);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
  expect(guiApi.request).toHaveBeenLastCalledWith({ ...request.body, maxBytes: MIB });
});
it('accepts limits above 1 GB and safely encodes the largest configurable integer', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, videoPreviewMaxMb: 1000000 });
  expect(videoByteLimit()).toBe(1000000 * MIB);
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, videoPreviewMaxMb: Number.MAX_SAFE_INTEGER });
  expect(videoByteLimit()).toBe(Number.MAX_SAFE_INTEGER);
});
it('retains open acknowledgements for retries and preserves safe errors', async () => {
  const info = { id: 'session', size: 1000, mimeType: 'video/mp4' };
  vi.mocked(guiApi.request).mockResolvedValueOnce(info).mockRejectedValueOnce('视频超过管理员设置的播放大小上限。');
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, method: 'request' as const, id: 'open:1',
    body: { operation: 'videoOpen', threadId: 'thread', path: 'movie.mp4' } };
  expect(await operations.execute(request)).toMatchObject({ data: info });
  await operations.execute(request);
  expect(guiApi.request).toHaveBeenCalledTimes(1);
  expect(await operations.execute({ ...request, id: 'open:2' }))
    .toMatchObject({ error: expect.stringContaining('上限') });
});
