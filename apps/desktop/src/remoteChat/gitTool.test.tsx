// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useRemoteGit } from '../../../../shared/remote-chat/useRemoteGit';
import { gitGraph, GRAPH_ROW_HEIGHT } from '../../../../shared/remote-chat/gitGraph';
import { createAsyncGitFixture } from '../../../../shared/remote-chat/testing/gitFixture';
import type { GitChanges } from '../../../../shared/remote-chat/gitTypes';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
function fixture() {
  const client = createAsyncGitFixture();
  client.changes = vi.fn(client.changes);
  client.commit = vi.fn(client.commit);
  client.action = vi.fn(client.action);
  const root = createRoot(document.createElement('div'));
  let panel!: ReturnType<typeof useRemoteGit>;
  function Fixture({ cwd, connected }: { cwd: string; connected: boolean }) {
    panel = useRemoteGit({ client, cwd, active: true, connected }); return null;
  }
  return { client, panel: () => panel, dispose: () => act(async () => root.unmount()),
    render: (cwd = '/project', connected = true) => act(async () =>
      root.render(<Fixture cwd={cwd} connected={connected} />)) };
}

it('keeps selection and message on failure and commits only selected file versions', async () => {
  const test = fixture();
  try {
    await test.render();
    await act(async () => { test.panel().toggle(test.panel().changes!.files[0]); test.panel().setMessage('fail'); });
    await act(async () => test.panel().commit());
    expect(test.panel().error).toContain('提交未完成');
    expect(Object.keys(test.panel().selected)).toEqual(['src/app.ts']);
    expect(test.panel().message).toBe('fail');
    await act(async () => test.panel().setMessage('selected only'));
    await act(async () => test.panel().commit());
    expect(test.client.commit).toHaveBeenLastCalledWith(expect.objectContaining({
      files: [{ path: 'src/app.ts', version: 'app-v1' }], message: 'selected only' }));
    expect(test.panel().changes!.files.map(file => file.path)).toContain('README.md');
    expect(test.panel().message).toBe('');
  } finally { await test.dispose(); }
});

it('drops stale selections after refresh and prevents commits with conflicts or while offline', async () => {
  const test = fixture();
  try {
    await test.render();
    await act(async () => { test.panel().toggle(test.panel().changes!.files[0]); test.panel().setMessage('message'); });
    const next = structuredClone(test.panel().changes!);
    next.files[0].version = 'changed';
    vi.mocked(test.client.changes).mockResolvedValue(next);
    await act(async () => test.panel().refresh());
    expect(test.panel().selected).toEqual({});
    next.files[1].conflict = true;
    await act(async () => { test.panel().toggle(next.files[0]); });
    expect(test.panel().canCommit).toBe(false);
    await test.render('/project', false);
    await act(async () => test.panel().commit());
    expect(test.client.commit).not.toHaveBeenCalled();
  } finally { await test.dispose(); }
});

it('ignores old project reads and allows the new project to load immediately', async () => {
  const test = fixture();
  let finish!: (changes: GitChanges) => void;
  vi.mocked(test.client.changes).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    await test.render('/old');
    await test.render('/new');
    expect(test.panel().changes?.root).toBe('/new');
    await act(async () => finish({ root: '/old', branch: 'old', head: null, files: [] }));
    expect(test.panel().changes?.root).toBe('/new');
  } finally { await test.dispose(); }
});

it('draws both merge parents and keeps graph positions stable as older commits load', async () => {
  const client = createAsyncGitFixture();
  const first = await client.history('/project', 0);
  const more = await client.history('/project', first.commits.length);
  const short = gitGraph(first.commits);
  const full = gitGraph([...first.commits, ...more.commits]);
  expect(full.rows.slice(0, first.commits.length)).toEqual(short.rows);
  const outgoing = full.rows[0].lines.filter(line => line.y1 === GRAPH_ROW_HEIGHT / 2);
  expect(outgoing).toHaveLength(2);
  expect(new Set(outgoing.map(line => line.x2)).size).toBe(2);
  expect(full.rows.every(row => row.lines.every(line => line.x2 >= 0))).toBe(true);
});

it('defaults to merge, switches branches and refreshes conflicts after a failed update', async () => {
  const test = fixture();
  try {
    await test.render();
    await act(async () => test.panel().action('switch', 'refs/heads/feature/git'));
    expect(test.panel().changes?.branch).toBe('feature/git');
    expect(test.panel().strategy).toBe('merge');
    const next = structuredClone(test.panel().changes!);
    next.files[0].conflict = true;
    vi.mocked(test.client.changes).mockResolvedValue(next);
    vi.mocked(test.client.action).mockRejectedValueOnce(new Error('update conflict'));
    await act(async () => test.panel().action('update'));
    expect(test.panel().error).toBe('update conflict');
    expect(test.panel().changes?.files[0].conflict).toBe(true);
    expect(test.panel().notice).toBe('');
    expect(test.client.action).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'update', strategy: 'merge' }));
  } finally { await test.dispose(); }
});

it('always updates by merge without changing the strategy selected for pull', async () => {
  const test = fixture();
  try {
    await test.render();
    vi.mocked(test.client.action).mockResolvedValue(undefined);
    await act(async () => test.panel().setStrategy('rebase'));
    await act(async () => test.panel().action('update'));
    expect(test.client.action).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'update', strategy: 'merge' }));
    expect(test.panel().notice).toBe('项目已更新');
    expect(test.panel().strategy).toBe('rebase');
    await act(async () => test.panel().action('pull'));
    expect(test.client.action).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'pull', strategy: 'rebase' }));
  } finally { await test.dispose(); }
});
