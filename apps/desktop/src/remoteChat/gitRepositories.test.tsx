import { expect, it, vi } from 'vitest';
import { createGitWorkspaceClient } from '../../../../shared/remote-chat/gitWorkspaceClient';
import { createAsyncGitFixture } from '../../../../shared/remote-chat/testing/gitFixture';
import { fileTree } from '../../../../shared/remote-chat/gitFiles';
import { createGuiToolsClient } from '../../../../shared/remote-chat/guiTools';
import type { GitChanges, GitClient, GitCommitRequest } from '../../../../shared/remote-chat/gitTypes';
import { localGitClient } from '../pages/codexGui/localGitClient';
import { invoke } from '../api/backend';

vi.mock('../api/backend', () => ({ invoke: vi.fn() }));

function fixture() {
  const roots = ['/project', '/project/child', '/project/child/nested'];
  const entries = roots.map(root => ({ root, path: root.slice('/project'.length).replace(/^\//, ''), available: true }));
  const states = new Map(roots.map((root, index) => [root, { root, branch: 'main', head: `head-${index}`,
    files: [{ path: 'file.txt', originalPath: null, status: ' M', conflict: false, version: `v-${index}` }],
  } as GitChanges]));
  const original = createAsyncGitFixture();
  const events: string[] = [];
  const client: GitClient = { ...original,
    changes: vi.fn(async cwd => structuredClone(states.get(cwd)!)),
    repository: vi.fn(async (cwd, discover) => ({ ...await original.repository(cwd),
      ...(discover ? { repositories: [...entries, { root: '/project/missing', path: 'missing', available: false }] } : {}) })),
    commit: vi.fn(async (input: GitCommitRequest) => {
      const state = states.get(input.cwd)!;
      expect(input.head).toBe(state.head);
      for (const file of input.files) expect(state.files).toContainEqual(expect.objectContaining(file));
      state.files = state.files.filter(file => !input.files.some(selected => selected.path === file.path));
      const hash = `${state.head}-commit`;
      state.head = hash;
      const index = roots.indexOf(input.cwd);
      if (index > 0) states.get(roots[index - 1])!.files.push({
        path: index === 1 ? 'child' : 'nested', version: hash, status: ' M', originalPath: null,
        conflict: false, submodule: true, referenceChanged: true,
      });
      events.push(`commit:${input.cwd}`);
      return { hash };
    }),
    action: vi.fn(async input => { events.push(`${input.action}:${input.cwd}`); }),
  };
  return { client, states, events, workspace: createGitWorkspaceClient(client, '/project').client };
}

it('merges file paths into one tree and keeps missing or clean submodules visible without reading them', async () => {
  const test = fixture();
  const state = await test.workspace.changes('/project');
  expect(state.files.map(file => file.path)).toEqual(['file.txt', 'child/file.txt', 'child/nested/file.txt']);
  const tree = fileTree(state.files, state.repositories);
  const child = tree.find(node => node.path === 'child')!;
  expect(child.repository?.root).toBe('/project/child');
  expect(child.files).toHaveLength(2);
  expect(child.children.find(node => node.name === 'nested')?.repository?.available).toBe(true);
  expect(tree.find(node => node.path === 'missing')?.repository?.available).toBe(false);
  expect(test.client.changes).not.toHaveBeenCalledWith('/project/missing');
  await test.workspace.diff('/project', 'child/nested/file.txt');
});

it('commits and pushes mixed selections deepest first and includes only required ancestor references', async () => {
  const test = fixture();
  const state = await test.workspace.changes('/project');
  await test.workspace.commitAndPush!({ cwd: '/project', head: state.head, message: 'selected',
    files: state.files.filter(file => file.path !== 'child/file.txt') });
  expect(test.events).toEqual(['commit:/project/child/nested', 'push:/project/child/nested',
    'commit:/project/child', 'push:/project/child', 'commit:/project', 'push:/project']);
  expect(test.client.commit).toHaveBeenNthCalledWith(2, expect.objectContaining({ files: [
    { path: 'nested', version: 'head-2-commit' },
  ] }));
  expect(test.states.get('/project/child')!.files.map(file => file.path)).toEqual(['file.txt']);
  expect(test.states.get('/project')!.files).toEqual([]);
});

it('validates every selected version and all upstreams before the first commit', async () => {
  const test = fixture();
  const state = await test.workspace.changes('/project');
  const input = { cwd: '/project', head: state.head, message: 'selected', files: state.files };
  test.states.get('/project')!.files[0].version = 'changed';
  await expect(test.workspace.commit(input)).rejects.toThrow('filesOrBranches');
  expect(test.client.commit).not.toHaveBeenCalled();
  test.states.get('/project')!.files[0].version = state.files[0].version;
  const repository = test.client.repository;
  test.client.repository = vi.fn(async (cwd, include) => ({ ...await repository(cwd, include),
    ...(cwd === '/project/child' ? { upstream: null } : {}) }));
  await expect(test.workspace.commitAndPush!(input)).rejects.toThrow('跟踪分支');
  expect(test.client.commit).not.toHaveBeenCalled();
});

it('stops after a failed child push and does not commit or publish any ancestor', async () => {
  const test = fixture();
  const state = await test.workspace.changes('/project');
  test.client.action = vi.fn(async () => { throw new Error('network failed'); });
  await expect(test.workspace.commitAndPush!({ cwd: '/project', head: state.head, message: 'selected',
    files: state.files })).rejects.toThrow('network failed');
  expect(test.events).toEqual(['commit:/project/child/nested']);
  expect(test.states.get('/project')!.head).toBe('head-0');
  expect(test.states.get('/project/child/nested')!.files).toEqual([]);
  expect(test.states.get('/project/child')!.files.some(file => file.path === 'nested')).toBe(true);
});

it('detects edits to an unselected ancestor while a child submission is in progress', async () => {
  const test = fixture();
  const state = await test.workspace.changes('/project');
  test.client.action = vi.fn(async () => { test.states.get('/project/child')!.head = 'external-commit'; });
  await expect(test.workspace.commitAndPush!({ cwd: '/project', head: state.head, message: 'selected',
    files: state.files.filter(file => file.path === 'child/nested/file.txt') })).rejects.toThrow('已变化');
  expect(test.events).toEqual(['commit:/project/child/nested']);
});

it('leaves dirty-only parent references out of the selection and preserves single-repository hosts', async () => {
  const test = fixture();
  test.states.get('/project')!.files.push({ path: 'child', version: 'dirty', status: ' M',
    originalPath: null, conflict: false, submodule: true, referenceChanged: false });
  expect((await test.workspace.changes('/project')).files.some(file => file.path === 'child')).toBe(false);
  const old = createAsyncGitFixture();
  const workspace = createGitWorkspaceClient(old, '/project').client;
  expect((await workspace.changes('/project')).files).toEqual((await old.changes('/project')).files);
});

it('passes discovery through local and authenticated remote transports', async () => {
  const request = vi.fn(async () => ({}));
  await createGuiToolsClient(request as <T>(body: object) => Promise<T>).git.repository('/project', true);
  expect(request).toHaveBeenCalledWith({ operation: 'guiGitRepository', cwd: '/project', includeChildren: true });
  await localGitClient.repository('/project', true);
  expect(invoke).toHaveBeenCalledWith('codex_gui_git_tool', { request: {
    operation: 'repository', cwd: '/project', includeChildren: true } });
});
