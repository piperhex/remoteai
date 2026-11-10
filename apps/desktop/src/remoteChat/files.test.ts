import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RemoteFiles } from './files';
import { invoke } from '../api/backend';
import { DEFAULT_CHAT_POLICY, MIB, setChatPolicy } from '../../../../shared/remote-chat/policy';

vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
beforeEach(() => vi.resetAllMocks());
afterEach(() => setChatPolicy(DEFAULT_CHAT_POLICY));

it('checks the Admin PDF limit on streaming previews and releases a rejected session', async () => {
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, filePreviewMaxMb: 1, fileDownloadMaxMb: 100 });
  const files = new RemoteFiles();
  const result = { sessionId: 'pdf-session', path: 'paper.pdf', name: 'paper.pdf', kind: 'pdf', size: 3 * MIB };
  vi.mocked(invoke).mockResolvedValueOnce(result);
  await expect(files.request({ operation: 'guiFilePreviewOpen', target: { path: 'paper.pdf' } }, 'viewer', 'relay'))
    .rejects.toMatchObject({ code: 'PREVIEW_UNAVAILABLE' });
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_close_file_preview', { sessionId: 'pdf-session' });
  vi.mocked(invoke).mockResolvedValueOnce(result);
  await expect(files.request({ operation: 'guiFilePreviewOpen', target: { path: 'paper.pdf' } }, 'viewer', 'direct'))
    .resolves.toMatchObject(result);
  files.release();
});

it('binds previews and streams to the transport owner and overrides forged scopes', async () => {
  const files = new RemoteFiles();
  vi.mocked(invoke).mockResolvedValueOnce({ sessionId: 'preview', path: 'F:/remote/a.md' });
  await files.request({ operation: 'guiFilePreviewOpen', target: { path: 'F:/remote/a.md' } }, 'one');
  await expect(files.request({ operation: 'guiFilePreviewHost', id: 'preview', host: '127.0.0.1:123' }, 'two'))
    .rejects.toThrow('连接已断开');
  await files.request({ operation: 'guiFilePreviewHost', id: 'preview', host: '127.0.0.1:123' }, 'one');
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_file_preview_host',
    { sessionId: 'preview', host: '127.0.0.1:123' });
  vi.mocked(invoke).mockResolvedValueOnce('resource');
  await files.request({ operation: 'guiResourceOpen', url: 'http://localhost:3000' }, 'one');
  for (const action of ['open', 'close']) await expect(files.request({ operation: 'guiResourceStream',
    resource: 'resource', action, id: 'socket' }, 'two')).rejects.toThrow('连接已断开');
  await files.request({ operation: 'guiResourceLink', id: 'resource',
    request: { type: 'read', id: 'stream', scope: 'forged' } }, 'one');
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_resource_link',
    { request: { type: 'read', id: 'stream', scope: 'resource' } });
  for (const type of ['udpConnect', 'udpRead', 'udpWrite', 'udpClose']) {
    await expect(files.request({ operation: 'guiResourceLink', id: 'resource', request: { type } }, 'two'))
      .rejects.toThrow();
    await files.request({ operation: 'guiResourceLink', id: 'resource',
      request: { type, id: 'udp', scope: 'forged' } }, 'one');
    expect(invoke).toHaveBeenLastCalledWith('codex_gui_resource_link',
      { request: { type, id: 'udp', scope: 'resource' } });
  }
  for (const type of ['listen', 'udpListen', 'accept', 'stop']) await expect(files.request({ operation: 'guiResourceLink',
    id: 'resource', request: { type } }, 'one')).rejects.toThrow();
  files.release('two');
  expect(invoke).not.toHaveBeenCalledWith('codex_gui_close_file_preview', expect.anything());
  files.release('one');
  expect(invoke).toHaveBeenCalledWith('codex_gui_close_file_preview', { sessionId: 'preview' });
  expect(invoke).toHaveBeenCalledWith('codex_gui_resource_link', { request: { type: 'stop', scope: 'resource' } });
});

it('releases a late preview after disconnect and never reassigns it to a new owner', async () => {
  const files = new RemoteFiles();
  let finish!: (data: unknown) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const opening = files.request({ operation: 'guiFilePreviewOpen', target: {} }, 'old');
  files.release('old');
  finish({ sessionId: 'late' });
  await expect(opening).rejects.toThrow();
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_close_file_preview', { sessionId: 'late' });
  await expect(files.request({ operation: 'guiFilePreviewHost', id: 'late', host: '127.0.0.1:123' }, 'new'))
    .rejects.toThrow();
});

it('forwards file actions intact to host validation and does not open a remote save dialog', async () => {
  const files = new RemoteFiles();
  const target = { threadId: 'remote-thread', path: 'F:/remote/a.ts', line: 18, column: 4 };
  for (const action of [{ type: 'open', application: 'vscode' }, { type: 'copyContents' },
    { type: 'reveal' }, { type: 'metadata' }]) {
    await files.request({ operation: 'guiFileAction', target, action }, 'one');
    expect(invoke).toHaveBeenLastCalledWith('codex_gui_file_action', { request: { target, action } });
  }
  await expect(files.request({ operation: 'guiFileAction', target, action: { type: 'saveAs' } }, 'one'))
    .rejects.toThrow('请选择有效的文件操作');
});
