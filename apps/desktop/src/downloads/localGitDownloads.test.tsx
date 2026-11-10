// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useLocalGitDownloads, LOCAL_DOWNLOAD_OWNER } from './localGitDownloads';
import { localGitClient } from '../pages/codexGui/localGitClient';
import { guiApi } from '../../../../shared/conversation/api';
import { downloadManager } from '../../../../shared/downloads/manager';
import { enqueueGitPatch } from '../../../../shared/downloads/gitPatch';
import { createAsyncGitFixture } from '../../../../shared/remote-chat/testing/gitFixture';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn(async () => ({})) } }));
vi.mock('../api/backend', () => ({ isDesktopApp: true, invoke: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/localization/uiText', async () => ({ ...await vi.importActual<typeof import('../../../../shared/localization/uiText')>('../../../../shared/localization/uiText'),  }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('queues local and remote patches against their own computer and keeps local transfers after closing Git', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  function Fixture() { useLocalGitDownloads(); return null; }
  await act(async () => root.render(<Fixture />));
  const local = downloadManager.connectionForGit(localGitClient)!;
  const remoteGit = createAsyncGitFixture();
  const remote = { ...local, owner: 'remote-owner', deviceId: 'remote-computer', deviceName: '另一台电脑',
    files: { ...local.files }, git: remoteGit };
  downloadManager.register(remote);
  const enqueue = vi.spyOn(downloadManager, 'enqueue').mockResolvedValue('task');
  try {
    const commit = 'a'.repeat(40);
    await enqueueGitPatch(localGitClient, 'C:/local-project', commit);
    expect(enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ owner: LOCAL_DOWNLOAD_OWNER,
      deviceId: 'local', cwd: 'C:/local-project', gitCommit: commit }));
    await enqueueGitPatch(remoteGit, '/remote-project', commit);
    expect(enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ owner: 'remote-owner',
      deviceId: 'remote-computer', cwd: '/remote-project', gitCommit: commit }));
    await local.client.open({ scope: 'project', cwd: 'C:/local-project', path: 'a.patch',
      gitCommit: commit, transferId: 'transfer' });
    expect(guiApi.request).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'downloadOpen',
      gitCommit: commit, transferId: 'transfer', maxBytes: Number.MAX_SAFE_INTEGER }));
    await local.client.read({ threadId: 'transfer', id: 'handle', offset: 0, length: 1024 });
    expect(guiApi.request).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'fileRead',
      threadId: 'transfer', id: 'handle' }));
    downloadManager.unbind(remote.files);
    await expect(enqueueGitPatch(remoteGit, '/remote-project', commit)).rejects.toThrow('电脑连接后');
  } finally {
    await act(async () => root.unmount());
    expect(downloadManager.connectionForGit(localGitClient)).toBe(local);
    downloadManager.unbind(local.files); downloadManager.unbind(remote.files);
  }
});
