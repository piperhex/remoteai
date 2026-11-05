// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAsyncGitFixture } from '../../../../shared/remote-chat/testing/gitFixture';
import { createGitWorkspaceClient } from '../../../../shared/remote-chat/gitWorkspaceClient';
import { useRemoteGit, type RemoteGit } from '../../../../shared/remote-chat/useRemoteGit';

const project = '/project';
const child = '/project/child';
let root: ReturnType<typeof createRoot>;
let panel: RemoteGit;
let source: ReturnType<typeof createAsyncGitFixture>;
let workspace: ReturnType<typeof createGitWorkspaceClient>;
let childAvailable: boolean;

function Fixture() {
  panel = useRemoteGit({ client: workspace.client, cwd: project,
    active: true, connected: true, refreshInterval: 1000 });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  childAvailable = true;
  source = createAsyncGitFixture();
  const repository = source.repository;
  const history = source.history;
  source.repository = vi.fn(async (cwd, discover) => ({ ...await repository(cwd),
    ...(discover ? { repositories: [{ root: project, path: '', available: true },
      { root: child, path: 'child', available: childAvailable }] } : {}) }));
  source.history = vi.fn(async (cwd, skip) => {
    const page = await history(cwd, skip);
    return { ...page, commits: page.commits.map(commit => ({ ...commit, subject: `${cwd}: ${commit.subject}` })) };
  });
  workspace = createGitWorkspaceClient(source, project);
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('pages the selected repository and preserves mixed selection and the commit draft', async () => {
  expect(source.history).toHaveBeenCalledExactlyOnceWith(project, 0);
  await act(async () => {
    panel.toggle(panel.changes!.files[0]);
    panel.toggle(panel.changes!.files.find(file => file.path === 'child/src/app.ts')!);
    panel.setMessage('keep draft');
  });
  const selected = panel.selected;
  await act(async () => panel.more());
  expect(panel.commits).toHaveLength(5);
  await act(async () => panel.selectHistoryRepository(child));
  expect(panel.historyRepository).toBe(child);
  expect(panel.commits).toHaveLength(3);
  expect(panel.commits.every(commit => commit.repository === child)).toBe(true);
  expect(source.history).toHaveBeenLastCalledWith(child, 0);
  await act(async () => panel.more());
  expect(source.history).toHaveBeenLastCalledWith(child, 3);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(source.history).toHaveBeenLastCalledWith(child, 0);
  expect(panel.commits).toHaveLength(5);
  expect(panel.selected).toEqual(selected);
  expect(panel.message).toBe('keep draft');
  await act(async () => panel.selectHistoryRepository(project));
  expect(panel.commits).toHaveLength(3);
  expect(panel.commits.every(commit => commit.repository === project)).toBe(true);
});

it('waits for background reads before switching and retries failed history in the selected repository', async () => {
  const page = await workspace.client.history(project, 0);
  let finish!: () => void;
  vi.mocked(source.history).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(page); }));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  let switching!: Promise<void>;
  await act(async () => { switching = panel.selectHistoryRepository(child); });
  expect(panel.busy).toBe(true);
  expect(panel.historyRepository).toBe(project);
  vi.mocked(source.history).mockRejectedValueOnce(new Error('history unavailable'));
  await act(async () => { finish(); await switching; });
  expect(panel.historyRepository).toBe(child);
  expect(panel.commits).toEqual([]);
  expect(panel.error).toBe('history unavailable');
  await act(async () => panel.refresh());
  expect(panel.error).toBe('');
  expect(panel.commits.every(commit => commit.repository === child)).toBe(true);
});

it('returns to the main repository when the selected checkout becomes unavailable', async () => {
  await act(async () => panel.selectHistoryRepository(child));
  childAvailable = false;
  workspace.refreshRepositories();
  await act(async () => panel.refresh());
  expect(panel.historyRepository).toBe(project);
  expect(panel.commits.every(commit => commit.repository === project)).toBe(true);
  await act(async () => panel.selectHistoryRepository(child));
  expect(panel.historyRepository).toBe(project);
});
