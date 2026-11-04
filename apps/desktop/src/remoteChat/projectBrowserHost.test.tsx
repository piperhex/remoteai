// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserHost } from '../../../../shared/project-browser/entryActions';
import { createProjectBrowserClient } from '../../../../shared/project-browser/protocol';
import { downloadProjectEntry } from '../../../../shared/project-browser/downloads';
import { browserHost } from '../../../../shared/project-browser/views/browserHost';
import { downloadManager } from '../../../../shared/downloads/manager';
import { fileApi } from '../../../../shared/conversation/fileApi';
import { terminalDirectory } from '../../../../shared/project-browser/terminalDirectory';

const platform = vi.hoisted(() => ({ desktop: true }));
vi.mock('../api/backend', () => ({ get isDesktopApp() { return platform.desktop; } }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
vi.mock('../../../../shared/conversation/fileApi', () => ({ fileApi: { perform: vi.fn() } }));
vi.mock('../../../../shared/downloads/manager', () => ({
  downloadManager: { connectionForProjectBrowser: vi.fn(), enqueue: vi.fn() },
}));
vi.mock('../../../../shared/project-browser/views/ProjectBrowserButton', () => ({ ProjectBrowserButton: () => null }));
beforeEach(() => { vi.clearAllMocks(); });

it('opens local folders and files in the system browser', async () => {
  const { LocalProjectBrowser } = await import('../pages/codexGui/LocalProjectBrowser');
  const element = LocalProjectBrowser({ cwd: '/project', active: true, connected: true });
  const host = (element.props as { host: BrowserHost }).host;
  await host.open!({ name: 'folder', path: '/project/folder', directory: true });
  expect(fileApi.perform).toHaveBeenLastCalledWith({ path: '/project/folder', threadId: null },
    { type: 'open', application: 'default' });
  await host.open!({ name: 'file', path: '/project/file', directory: false });
  expect(fileApi.perform).toHaveBeenLastCalledWith({ path: '/project/file', threadId: null },
    { type: 'open', application: 'explorer' });
});

it.each([
  ['/project/src/file.ts', '/project/src'], ['/file.ts', '/'],
  ['C:/file.ts', 'C:/'], ['C:\\file.ts', 'C:\\'],
  ['C:\\项目 空格\\src\\file.ts', 'C:\\项目 空格\\src'],
  ['\\\\server\\share\\file.ts', '\\\\server\\share'],
])('opens file %s in its containing directory', (path, directory) => {
  expect(terminalDirectory({ name: 'file.ts', path, directory: false })).toBe(directory);
  expect(terminalDirectory({ name: 'folder', path: directory, directory: true })).toBe(directory);
});

it('queues a remote folder using the matching computer and pinned project', async () => {
  const client = createProjectBrowserClient(vi.fn());
  vi.mocked(downloadManager.connectionForProjectBrowser).mockReturnValue({
    owner: 'owner', deviceId: 'pc', deviceName: 'Computer', ready: true, mode: 'direct',
    client: {} as never, files: {} as never, projectBrowser: client,
  });
  const host = browserHost(client);
  expect(host.open).toBeUndefined();
  await host.download!({ cwd: '/project', path: '/project/folder' });
  expect(downloadManager.connectionForProjectBrowser).toHaveBeenCalledWith(client);
  expect(downloadManager.enqueue).toHaveBeenCalledWith({
    owner: 'owner', deviceId: 'pc', deviceName: 'Computer', scope: 'project',
    cwd: '/project', path: '/project/folder',
  });
});

it('streams a generated ZIP through the direct fallback and closes its remote session', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const client = { open: vi.fn().mockResolvedValue({ id, name: 'folder.zip', mimeType: 'application/zip', size: 3 }),
    read: vi.fn().mockResolvedValue({ offset: 0, data: 'emlw' }),
    close: vi.fn().mockResolvedValue(undefined), browse: vi.fn() };
  const target = { write: vi.fn().mockResolvedValue(undefined), finish: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined) };
  await downloadProjectEntry({ client, file: { cwd: '/project', path: '/project/folder' }, transferId: id,
    signal: new AbortController().signal, target: async info => { expect(info.name).toBe('folder.zip'); return target; },
    progress: vi.fn() });
  expect(client.open).toHaveBeenCalledWith(
    { scope: 'project', cwd: '/project', path: '/project/folder', transferId: id },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(target.write).toHaveBeenCalledWith('emlw');
  expect(target.finish).toHaveBeenCalledOnce();
  expect(client.close).toHaveBeenCalledWith(id, id);
  expect(target.dispose).toHaveBeenCalledOnce();
});
