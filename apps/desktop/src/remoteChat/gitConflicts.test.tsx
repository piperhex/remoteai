// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRemoteGit, type RemoteGit } from '../../../../shared/remote-chat/useRemoteGit';
import { createAsyncGitFixture } from '../../../../shared/remote-chat/testing/gitFixture';
import { createGuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import { localGitClient } from '../pages/codexGui/localGitClient';
import { invoke } from '../api/backend';
import { guiToolRequest } from './guiTools';

vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: vi.fn() }));
let client: ReturnType<typeof createAsyncGitFixture>;
let root: ReturnType<typeof createRoot>;
let panel: RemoteGit;
function Fixture({ cwd = '/project', connected = true }: { cwd?: string; connected?: boolean }) {
  panel = useRemoteGit({ client, cwd, active: true, connected }); return null;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = createAsyncGitFixture();
  const changes = await client.changes('/project');
  changes.files[0] = { ...changes.files[0], conflict: true, status: 'UU' };
  changes.integration = { kind: 'merge', version: 'merge-v1' };
  vi.spyOn(client, 'changes').mockResolvedValue(changes);
  vi.spyOn(client, 'resolveConflict'); vi.spyOn(client, 'continueIntegration');
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('retains the editor snapshot across polling and keeps the draft on a stale-save error', async () => {
  await act(async () => panel.openConflict('src/app.ts'));
  const snapshot = panel.conflict;
  await act(async () => panel.refresh());
  expect(panel.conflict).toBe(snapshot);
  vi.mocked(client.resolveConflict).mockRejectedValueOnce('client.gitConflict.changed');
  await act(async () => panel.saveConflict('manual\n'));
  expect(panel.conflict).toBe(snapshot);
  expect(panel.error).toBe('client.gitConflict.changed');
  await act(async () => panel.saveConflict('resolved\n'));
  expect(client.resolveConflict).toHaveBeenLastCalledWith({ cwd: '/project', path: 'src/app.ts',
    version: snapshot!.version, content: 'resolved\n' });
  expect(panel.conflict).toBeNull();
});

it('blocks offline writes, discards the old scope, and refreshes conflicts after failed continuation', async () => {
  await act(async () => panel.openConflict('src/app.ts'));
  await act(async () => root.render(<Fixture connected={false} />));
  await act(async () => panel.saveConflict('offline'));
  expect(client.resolveConflict).not.toHaveBeenCalled();
  await act(async () => root.render(<Fixture cwd="/other" />));
  expect(panel.conflict).toBeNull();
  await act(async () => panel.continueIntegration());
  expect(client.continueIntegration).not.toHaveBeenCalled();
  const state = { ...panel.changes!, files: [] };
  vi.mocked(client.changes).mockResolvedValue(state);
  await act(async () => panel.refresh());
  vi.mocked(client.continueIntegration).mockRejectedValueOnce('client.gitConflict.continueFailed');
  await act(async () => panel.continueIntegration());
  expect(client.continueIntegration).toHaveBeenCalledWith('/other', 'merge-v1');
  expect(panel.error).toBe('client.gitConflict.continueFailed');
});

it('uses the same host commands for desktop local, desktop remote and web clients', async () => {
  const remoteRequest = async <T,>(body: object) => guiToolRequest(body as Record<string, unknown>) as Promise<T>;
  for (const git of [localGitClient, createGuiToolsClient(remoteRequest).git, createGuiToolsClient(remoteRequest).git]) {
    await git.conflict('/project', 'src/app.ts');
    expect(invoke).toHaveBeenLastCalledWith('codex_gui_git_tool', { request: {
      operation: 'conflict', cwd: '/project', path: 'src/app.ts' } });
    await git.resolveConflict({ cwd: '/project', path: 'src/app.ts', version: 'v1', content: 'chosen' });
    expect(invoke).toHaveBeenLastCalledWith('codex_gui_git_tool', { request: {
      operation: 'resolveConflict', cwd: '/project', path: 'src/app.ts', version: 'v1', content: 'chosen' } });
    await git.continueIntegration('/project', 'v2');
    expect(invoke).toHaveBeenLastCalledWith('codex_gui_git_tool', { request: {
      operation: 'continueIntegration', cwd: '/project', version: 'v2' } });
  }
});
