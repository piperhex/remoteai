// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRemoteGit } from '../../../../shared/remote-chat/useRemoteGit';
import { createAsyncGitFixture } from '../../../../shared/remote-chat/testing/gitFixture';
import { GitHistory } from '../../../../shared/git/views/GitHistory';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: ReturnType<typeof createAsyncGitFixture>;
let panel: ReturnType<typeof useRemoteGit>;
let intersect: () => void;
let viewport: number;
const disconnect = vi.fn();
const history = () => container.querySelector<HTMLDivElement>('.git-history')!;
const rows = () => container.querySelectorAll('.git-history-row');

function Fixture({ connected = true, cwd = '/project' }: { connected?: boolean; cwd?: string }) {
  panel = useRemoteGit({ client, cwd, active: true, connected });
  return <GitHistory panel={panel} connected={connected} />;
}
const render = (props: Parameters<typeof Fixture>[0] = {}) => act(async () => root.render(<Fixture {...props} />));
const scroll = (offset: number) => act(async () => {
  history().scrollTop = offset;
  history().dispatchEvent(new Event('scroll', { bubbles: true }));
});

beforeEach(() => {
  viewport = 300;
  client = createAsyncGitFixture();
  vi.spyOn(client, 'history');
  disconnect.mockClear();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: () => void) { intersect = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewport);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => rows().length * 200);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks();
});

it('loads near the bottom once, preserves position and waits for the bottom of each new page', async () => {
  await render();
  await act(async () => intersect());
  expect(rows()).toHaveLength(3);
  await scroll(100);
  expect(client.history).toHaveBeenCalledTimes(1);
  let finish!: () => void;
  const page = await createAsyncGitFixture().history('/project', 3);
  vi.mocked(client.history).mockImplementationOnce(() => new Promise(resolve => {
    finish = () => resolve({ ...page, hasMore: true });
  })).mockResolvedValueOnce({ commits: page.commits.map(commit => ({ ...commit, hash: `older-${commit.hash}` })),
    hasMore: false });
  await scroll(150);
  expect(history().textContent).toContain('正在加载…');
  await scroll(180); await scroll(200);
  expect(client.history).toHaveBeenCalledTimes(2);
  expect(client.history).toHaveBeenLastCalledWith('/project', 3);
  await act(async () => finish());
  expect(rows()).toHaveLength(5);
  expect(history().scrollTop).toBe(200);
  expect(client.history).toHaveBeenCalledTimes(2);
  await scroll(700);
  expect(rows()).toHaveLength(7);
  expect(client.history).toHaveBeenLastCalledWith('/project', 5);
  await scroll(1100);
  expect(client.history).toHaveBeenCalledTimes(3);
  expect(history().textContent).not.toContain('加载更多提交');
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('fills a short viewport and waits for reconnect before continuing', async () => {
  await render();
  await render({ connected: false });
  viewport = 800;
  await act(async () => intersect());
  expect(rows()).toHaveLength(3);
  expect(client.history).toHaveBeenCalledTimes(1);
  await render();
  expect(rows()).toHaveLength(5);
  expect(panel.hasMore).toBe(false);
});

it('pauses failed pages across scrolls and refreshes, and allows an explicit retry', async () => {
  await render();
  vi.mocked(client.history).mockRejectedValueOnce(new Error('History unavailable'));
  await scroll(300);
  expect(panel.error).toBe('History unavailable');
  expect(history().textContent).toContain('重试');
  await scroll(0); await scroll(300);
  expect(client.history).toHaveBeenCalledTimes(2);
  await act(async () => panel.refresh());
  expect(client.history).toHaveBeenCalledTimes(3);
  const retry = [...history().querySelectorAll('button')].find(button => button.textContent === '重试')!;
  await act(async () => retry.click());
  expect(rows()).toHaveLength(5);
  expect(history().textContent).not.toContain('重试');
});

it('resets a failed page when switching repositories', async () => {
  await render();
  vi.mocked(client.history).mockRejectedValueOnce(new Error('History unavailable'));
  await scroll(300);
  await render({ cwd: '/another-project' });
  expect(rows()).toHaveLength(5);
  expect(client.history).toHaveBeenLastCalledWith('/another-project', 3);
});
