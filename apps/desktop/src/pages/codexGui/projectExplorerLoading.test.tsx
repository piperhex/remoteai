// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useExplorer } from '../../../../../shared/project-explorer/useExplorer';
import { DIRECTORY_LOAD_TIMEOUT_MS } from '../../../../../shared/project-explorer/loadDirectory';
import type { ProjectDirectoriesResponse, ProjectPickerProps } from '../../../../../shared/remote-chat/projectDirectories';

let root: Root;
let state: ReturnType<typeof useExplorer>;
let load: ProjectPickerProps['load'];
const listing = (directory = ''): ProjectDirectoriesResponse => ({
  directory, parent: directory ? '' : null, truncated: false,
  entries: [{ name: 'Projects', path: 'C:/Projects', directory: true }],
  shortcuts: directory ? undefined : { home: 'C:/Users/Test', desktop: 'D:/Desktop' },
});
function Fixture({ cwd = '' }: { cwd?: string }) { state = useExplorer({ load, cwd }); return null; }
const render = async (cwd?: string) => { await act(async () => root.render(<Fixture cwd={cwd} />)); };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  load = vi.fn(async directory => listing(directory));
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('shares the initial computer request and reuses roots until explicitly refreshed', async () => {
  await render();
  expect(load).toHaveBeenCalledTimes(1);
  expect(state.roots).toHaveLength(1);
  await act(async () => state.navigate('C:/Projects'));
  await act(async () => state.navigate(''));
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => state.refresh());
  expect(load).toHaveBeenCalledTimes(3);
  expect(state.loading).toBe(false);
});

it('ends stalled computer loading, allows retry and ignores the timed-out reply', async () => {
  let finish!: (value: ProjectDirectoriesResponse) => void;
  vi.mocked(load).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render();
  expect(state.loading).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(DIRECTORY_LOAD_TIMEOUT_MS));
  expect(state.loading).toBe(false);
  expect(state.error).toBe(true);
  expect(state.rootsError).toBe(true);
  await act(async () => state.refresh());
  expect(state.error).toBe(false);
  expect(state.shortcuts?.desktop).toBe('D:/Desktop');
  await act(async () => finish({ ...listing(), entries: [] }));
  expect(state.entries).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('can leave a stalled folder and preserves shortcuts while refreshing', async () => {
  await render();
  let finish!: (value: ProjectDirectoriesResponse) => void;
  vi.mocked(load).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await act(async () => state.navigate('O:/offline'));
  expect(state.loading).toBe(true);
  await act(async () => state.travel(-1));
  expect(state.loading).toBe(false);
  expect(state.directory).toBe('');
  await act(async () => finish(listing('O:/offline')));
  expect(state.directory).toBe('');
  vi.mocked(load).mockReturnValueOnce(new Promise(() => {}));
  await act(async () => state.refresh());
  expect(state.shortcuts?.home).toBe('C:/Users/Test');
  await act(async () => state.navigate('D:/Desktop'));
  expect(state.directory).toBe('D:/Desktop');
  expect(state.loading).toBe(false);
});

it('does not reuse drives or shortcut paths after changing the host', async () => {
  await render();
  load = vi.fn(() => new Promise<ProjectDirectoriesResponse>(() => {}));
  await render();
  expect(state.roots).toEqual([]);
  expect(state.shortcuts).toEqual({});
  expect(state.loading).toBe(true);
});
