// @vitest-environment jsdom
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiController } from '../pages/codexGui/controller';
import { getGuiController } from '../pages/codexGui/session';
import { guiApi } from '../../../../shared/conversation/api';
import type { Request, Thread } from '../../../../shared/conversation/types';
import { ChatController } from '../../../../shared/remote-chat/client/controller';
import { directoryProject } from '../../../../shared/remote-chat/projectDirectories';
import type { ProjectFilesResponse } from '../../../../shared/remote-chat/projectFiles';
import type { RpcRequest } from '../../../../shared/remote-chat/protocol';
import { projectFileReference } from '../../../../shared/chat/useProjectFileCandidates';
import { ChatOperations } from './operations';

vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: vi.fn() }));
let host: GuiController;
let remote: ChatController;
let thread: Thread;
let root: string;
let projectA: string;
let projectB: string;

function backendFiles(request: Extract<Request, { operation: 'projectFiles' }>): ProjectFilesResponse {
  // Match Rust's boundary: a supplied thread wins over cwd, and browsing cannot escape its canonical root.
  const directory = realpathSync(request.threadId ? thread.cwd : request.cwd!);
  if (request.directory && realpathSync(request.directory) !== directory) throw new Error('无法读取项目文件。');
  return { directory, parent: null, truncated: false, entries: readdirSync(directory)
    .filter(name => name.includes(request.query ?? ''))
    .map(name => ({ name, path: join(directory, name), directory: false })) };
}

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  root = mkdtempSync(join(tmpdir(), 'remote-project-reference-'));
  projectA = join(root, 'project-a'); projectB = join(root, 'project-b');
  mkdirSync(projectA); mkdirSync(projectB);
  writeFileSync(join(projectA, 'unique-a.ts'), 'project a');
  writeFileSync(join(projectB, 'unique-b.ts'), 'project b');
  thread = { id: 'existing', cwd: projectA, preview: '', updatedAt: 1, turns: [] };
  host = new GuiController();
  vi.mocked(getGuiController).mockReturnValue(host);
  Object.assign(host.getSnapshot(), { connection: 'ready', threads: [thread], selected: 'local' });
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'projectDirectories') return { directory: realpathSync(request.directory!), entries: [] };
    if (request.operation === 'projectFiles') return backendFiles(request);
    return { thread };
  });
  const operations = new ChatOperations();
  let nextId = 0;
  remote = new ChatController(() => ({ start() {}, stop() {},
    request: async <T>(method: RpcRequest['method'], body?: unknown) => {
      const response = await operations.execute({ kind: 'request', id: String(++nextId), method, body });
      if (response.error) throw new Error(response.error);
      return response.data as T;
    } }));
  Object.assign(remote.snapshot(), { ready: true, selected: thread, threads: [thread] });
});

afterEach(() => {
  remote.stop(); host.dispose(); vi.restoreAllMocks();
  // root is exclusively owned by this test's mkdtempSync call.
  rmSync(root, { recursive: true, force: true });
});

it('references only B immediately after A→B is confirmed, before sending or resuming the existing thread', async () => {
  const before = await remote.loadProjectFiles({ threadId: thread.id, cwd: projectA, query: 'unique' });
  expect(before.entries.map(file => file.name)).toEqual(['unique-a.ts']);
  expect(await remote.selectProject(directoryProject(projectB))).toBe(true);
  expect(remote.snapshot().selected?.cwd).toBe(projectB);
  const files = await remote.loadProjectFiles({ threadId: thread.id,
    cwd: remote.snapshot().selected!.cwd, query: 'unique' });
  expect(files.entries.map(file => file.name)).toEqual(['unique-b.ts']);
  expect(projectFileReference(files.entries[0])).toEqual({ kind: 'file', name: 'unique-b.ts',
    path: join(projectB, 'unique-b.ts') });
  expect(thread.cwd).toBe(projectA);
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: 'projectFiles', cwd: projectB, query: 'unique' });
  const turns = vi.mocked(guiApi.request).mock.calls.filter(([request]) => ['send', 'resume'].includes(request.operation));
  expect(turns).toEqual([]);
});

it('ignores an unconfirmed client cwd and still uses A when project selection fails', async () => {
  expect(await remote.selectProject(directoryProject(join(root, 'missing')))).toBe(false);
  expect(remote.snapshot().selected?.cwd).toBe(projectA);
  const files = await remote.loadProjectFiles({ threadId: thread.id, cwd: projectB, query: 'unique' });
  expect(files.entries.map(file => file.name)).toEqual(['unique-a.ts']);
});

it('uses the host-confirmed project even if another client sends a stale or forged cwd', async () => {
  expect(await remote.selectProject(directoryProject(projectB))).toBe(true);
  const files = await remote.loadProjectFiles({ threadId: thread.id, cwd: projectA, query: 'unique' });
  expect(files.directory).toBe(projectB);
  await expect(remote.loadProjectFiles({ threadId: thread.id, cwd: projectA, directory: projectA }))
    .rejects.toThrow('无法读取项目文件');
});

it('does not fall back to the old thread when the confirmed project disappears', async () => {
  expect(await remote.selectProject(directoryProject(projectB))).toBe(true);
  rmSync(projectB, { recursive: true });
  await expect(remote.loadProjectFiles({ threadId: thread.id, cwd: projectA, query: 'unique' })).rejects.toThrow();
  expect(guiApi.request).toHaveBeenLastCalledWith({ operation: 'projectFiles', cwd: projectB, query: 'unique' });
});
