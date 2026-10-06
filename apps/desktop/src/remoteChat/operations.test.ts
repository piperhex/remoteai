// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { guiApi } from '../pages/codexGui/api';
import { remoteQueue } from './queue';
import { guiComposer } from '../pages/codexGui/composerBridge';
vi.mock('../pages/codexGui/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), respond: vi.fn() } }));
vi.mock('../pages/codexGui/composerBridge', () => ({ guiComposer: { validateSend: vi.fn() } }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(guiComposer.validateSend).mockResolvedValue({ model: 'model', effort: 'high', access: 'workspace-write' });
});

it('passes scoped text previews to the desktop and retains safe failure messages', async () => {
  const body = { operation: 'textPreview', threadId: 'chat', path: 'src/example.ts' };
  const data = { path: 'src/example.ts', text: 'const value = 1;\n' };
  vi.mocked(guiApi.request).mockResolvedValueOnce(data).mockRejectedValueOnce('文件暂时无法读取。');
  const operations = new ChatOperations();
  expect(await operations.execute({ kind: 'request', id: 'file:1', method: 'request', body }))
    .toMatchObject({ data });
  expect(guiApi.request).toHaveBeenCalledWith({ ...body, maxBytes: 2 * 1024 * 1024 });
  expect(await operations.execute({ kind: 'request', id: 'file:2', method: 'request', body }))
    .toMatchObject({ error: '文件暂时无法读取。' });
});

it.each(['text', 'thumbnail', 'image'])('opens a %s snapshot with the authenticated policy limit', async preview => {
  vi.mocked(guiApi.request).mockResolvedValue({ id: 'file', size: 12 });
  const body = { operation: 'previewOpen', threadId: 'chat', transferId: 'transfer', path: './image.png',
    preview, maxBytes: Number.MAX_SAFE_INTEGER };
  const operations = new ChatOperations();
  await operations.execute({ kind: 'request', id: `preview-${preview}`, method: 'request', body }, 'relay');
  expect(guiApi.request).toHaveBeenCalledWith({ ...body,
    maxBytes: (preview === 'text' ? 2 : 20) * 1024 * 1024 });
});

it('executes a retried mutation once even while the original is still running', async () => {
  let finish: (value: unknown) => void = () => undefined;
  vi.mocked(guiApi.request).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, id: 'phone:1', method: 'request' as const,
    body: { operation: 'send', text: 'continue', threadId: 'thread' } };
  const first = operations.execute(request);
  const retry = operations.execute(request);
  await vi.waitFor(() => expect(guiApi.request).toHaveBeenCalledTimes(1));
  finish({ turn: { id: 'turn' } });
  expect(await first).toEqual(await retry);
  expect(await operations.execute(request)).toEqual(await first);
  expect(guiApi.request).toHaveBeenCalledTimes(1);
  await expect(operations.execute({ ...request, body: { ...request.body, text: 'different' } })).rejects.toThrow();
});

it('acknowledges a retried enqueue only once through the PC queue', async () => {
  const enqueue = vi.spyOn(remoteQueue, 'request').mockResolvedValue({ revision: 1, threads: {} });
  const operations = new ChatOperations();
  const request = { kind: 'request' as const, id: 'queue:1', method: 'request' as const,
    body: { operation: 'queueEnqueue', threadId: 'phone', text: 'next', images: [] } };
  expect(await operations.execute(request)).toEqual(await operations.execute(request));
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(guiApi.request).not.toHaveBeenCalled();
  enqueue.mockRestore();
});

it('blocks arbitrary operations before reaching the desktop boundary', async () => {
  const result = await new ChatOperations().execute({ kind: 'request', id: 'invalid', method: 'request',
    body: { operation: 'execute_command', command: 'private operation' } });
  expect(result.error).toContain('暂不支持');
  expect(guiApi.request).not.toHaveBeenCalled();
});

it('preserves a running desktop session when a phone reconnects', async () => {
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  await new ChatOperations().execute({ kind: 'request', id: 'connect', method: 'connect' });
  expect(guiApi.connect).toHaveBeenCalledWith({ reuseExisting: true });
});

it('passes project photo browsing to the typed desktop boundary', async () => {
  const body = { operation: 'projectFiles', threadId: 'chat', directory: '', imagesOnly: true };
  vi.mocked(guiApi.request).mockResolvedValue({ directory: 'C:/project', parent: null, entries: [], truncated: false });
  const result = await new ChatOperations().execute({ kind: 'request', id: 'files', method: 'request', body });
  expect(result.error).toBeUndefined();
  expect(guiApi.request).toHaveBeenCalledWith(body);
  expect(result.data).toMatchObject({ directory: 'C:/project', entries: [] });
});

it('retains available skills when the plugin catalog fails', async () => {
  const skills = { data: [{ cwd: 'C:/project', skills: [], errors: [] }] };
  vi.mocked(guiApi.request).mockResolvedValueOnce(skills).mockRejectedValueOnce(new Error('unavailable'));
  const result = await new ChatOperations().execute({ kind: 'request', id: 'catalog', method: 'request',
    body: { operation: 'skills', cwd: 'C:/project', includePlugins: true } });
  expect(result.error).toBeUndefined();
  expect(result.data).toMatchObject({ data: [{ skills: [], errors: [] }], plugins: [], pluginsError: expect.any(String) });
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: 'plugins', cwd: 'C:/project' });
});

it('keeps accepting mutations after more than 512 incremental polls', async () => {
  vi.mocked(guiApi.request).mockResolvedValue({ data: [], nextCursor: null });
  const operations = new ChatOperations();
  for (let index = 0; index < 550; index++) {
    const result = await operations.execute({ kind: 'request', id: `poll:${index}`, method: 'request',
      body: { operation: 'list' } });
    expect(result.error).toBeUndefined();
  }
  const result = await operations.execute({ kind: 'request', id: 'send', method: 'request',
    body: { operation: 'send', threadId: 'chat', text: 'continue' } });
  expect(result.error).toBeUndefined();
});

it('preserves the safe error string returned by Tauri', async () => {
  vi.mocked(guiApi.request).mockRejectedValue('Codex 已断开连接，请重新连接后继续。');
  const result = await new ChatOperations().execute({ kind: 'request', id: 'read', method: 'request',
    body: { operation: 'read', threadId: 'chat' } });
  expect(result.error).toBe('Codex 已断开连接，请重新连接后继续。');
});

it('returns a bounded error for an oversized preview and still handles the next request', async () => {
  vi.mocked(guiApi.request).mockResolvedValueOnce({ url: 'a'.repeat(8 * 1024 * 1024) }).mockResolvedValue({ data: [] });
  const operations = new ChatOperations();
  const preview = await operations.execute({ kind: 'request', id: 'image', method: 'request',
    body: { operation: 'imagePreview', threadId: 'chat', source: 'large.png' } });
  expect(preview.error).toContain('图片暂时无法加载');
  expect(preview.data).toBeUndefined();
  expect(await operations.execute({ kind: 'request', id: 'list', method: 'request', body: { operation: 'list' } }))
    .toMatchObject({ data: { data: [] } });
});
