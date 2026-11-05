// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatOperations } from './operations';
import { RemoteTerminals } from './terminals';
import type { TerminalRead } from '../../../../shared/terminal/types';
import { guiApi } from '../../../../shared/conversation/api';
import { invoke } from '../api/backend';
import { terminalApi, type TerminalEvent } from '../pages/codexGui/terminal/api';
import { subscribeGuiEvent } from '../../../../shared/conversation/webEvents';

const state = vi.hoisted(() => ({ sending: false, workspaceBusy: false, approvals: [],
  conversations: {} as Record<string, { activeTurn: string | null }> }));
vi.mock('../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
vi.mock('../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn() } }));
vi.mock('../../../../shared/conversation/webEvents', () => ({ subscribeGuiEvent: vi.fn(async () => vi.fn()) }));
vi.mock('../pages/codexGui/session', () => ({ getGuiController: () => ({ getSnapshot: () => state }) }));
vi.mock('../pages/codexGui/terminal/api', () => ({
  terminalApi: { open: vi.fn(), write: vi.fn(), resize: vi.fn(), close: vi.fn() },
}));

const request = (id: string, body: object) => ({ kind: 'request' as const, method: 'request' as const, id, body });
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

it('routes remote Git generation and host preferences through the native Git service', async () => {
  const operations = new ChatOperations();
  const files = [{ path: 'chosen.ts', version: 'v1' }];
  await operations.execute(request('ai-message', { operation: 'guiGitGenerateMessage', cwd: '/project',
    head: 'head', files, language: 'zh' }));
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_git_tool', { request: {
    operation: 'generateMessage', cwd: '/project', head: 'head', files, language: 'zh' } });
  await operations.execute(request('git-settings', { operation: 'guiGitSettings', autoMessage: true }));
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_git_tool', {
    request: { operation: 'settings', autoMessage: true } });
});

it('keeps repository discovery and the selected child cwd in remote Git requests', async () => {
  const operations = new ChatOperations();
  await operations.execute(request('discover-repos', {
    operation: 'guiGitRepository', cwd: '/project', includeChildren: true }));
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_git_tool', { request: {
    operation: 'repository', cwd: '/project', includeChildren: true } });
  await operations.execute(request('child-changes', { operation: 'guiGitChanges', cwd: '/project/child' }));
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_git_tool', { request: {
    operation: 'changes', cwd: '/project/child' } });
});

it.each(['read', 'udpRead', 'udpWrite'])('keeps %s retries idempotent across long transfers and isolates reconnects',
  async type => {
  const operations = new ChatOperations();
  vi.mocked(invoke).mockResolvedValueOnce('resource');
  await operations.execute(request('resource', { operation: 'guiResourceOpen', url: 'http://localhost:1234' }),
    'relay', 'owner', 'same-account');
  vi.mocked(invoke).mockResolvedValue({ type: 'data', data: 'YQ==', eof: false });
  const stream = (id: string) => request(id, { operation: 'guiResourceLink', id: 'resource',
    request: { type, id: 'socket', ...(type === 'udpWrite' ? { packets: [{ peer: 'peer', data: 'YQ==' }] } : {}) } });
  for (let index = 0; index < 650; index++) {
    expect((await operations.execute(stream(`chunk-${index}`), 'relay', 'owner')).error).toBeUndefined();
    await operations.execute(stream(`chunk-${index}`), 'direct', 'owner');
  }
  expect(invoke).toHaveBeenCalledTimes(651);
  expect((await operations.execute(stream('other-owner'), 'relay', 'other', 'same-account')).error)
    .toContain('连接已断开');
  operations.release('owner');
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_resource_link', { request: { type: 'stop', scope: 'resource' } });
});
beforeEach(() => {
  vi.clearAllMocks(); state.conversations = {};
  vi.mocked(invoke).mockImplementation(async () => ({ version: '0.155.0' }));
  vi.mocked(terminalApi.open).mockResolvedValue({ id: 'terminal', cwd: '/remote', shell: 'bash' });
  vi.mocked(terminalApi.close).mockResolvedValue();
});

it('retains shells across new connections and isolates authenticated owners and mutation retries', async () => {
  const terminals = new RemoteTerminals();
  const operations = new ChatOperations(terminals);
  const open = request('open', { operation: 'guiTerminalOpen', cwd: '/remote', size: { cols: 80, rows: 24 } });
  await operations.execute(open, 'relay', 'one', 'account');
  const write = request('write', { operation: 'guiTerminalWrite', id: 'terminal', data: 'hello\r' });
  expect((await operations.execute(write, 'relay', 'one', 'account')).error).toBeUndefined();
  await operations.execute(write, 'direct', 'one', 'account');
  expect(terminalApi.write).toHaveBeenCalledOnce();
  expect((await operations.execute(write, 'relay', 'two')).error).toContain('已关闭');
  operations.release('two'); expect(terminalApi.close).not.toHaveBeenCalled();
  operations.release('one'); expect(terminalApi.close).not.toHaveBeenCalled();
  const reconnected = new ChatOperations(terminals);
  const list = request('list', { operation: 'guiTerminalList' });
  expect((await reconnected.execute(list, 'relay', 'new', 'account')).data)
    .toEqual([{ id: 'terminal', cwd: '/remote', shell: 'bash', projectCwd: '/remote' }]);
  expect((await reconnected.execute(list, 'relay', 'other', 'other-account')).data).toEqual([]);
  expect((await reconnected.execute(write, 'relay', 'new', 'account')).error).toBeUndefined();
  expect(terminalApi.open).toHaveBeenCalledOnce();
  await reconnected.execute(request('close', { operation: 'guiTerminalClose', id: 'terminal' }),
    'relay', 'new', 'account');
  expect(terminalApi.close).toHaveBeenCalledWith('terminal');
});

it('scopes terminal website connections to the authenticated owner and rejects local listener operations', async () => {
  const operations = new ChatOperations(new RemoteTerminals());
  await operations.execute(request('open-link-shell', { operation: 'guiTerminalOpen', cwd: '/remote', size: {} }),
    'relay', 'session', 'owner');
  vi.mocked(invoke).mockResolvedValue({ type: 'socket', id: 'stream' });
  const connect = request('connect-link', { operation: 'guiTerminalLink', id: 'terminal',
    request: { type: 'connect', url: 'http://localhost:3002', scope: 'forged' } });
  expect((await operations.execute(connect, 'relay', 'session', 'owner')).data).toEqual({ type: 'socket', id: 'stream' });
  expect(invoke).toHaveBeenCalledWith('codex_gui_terminal_link', {
    request: { type: 'connect', url: 'http://localhost:3002', scope: 'terminal' },
  });
  expect((await operations.execute(connect, 'relay', 'other', 'other-owner')).error).toContain('已关闭');
  const listen = request('forged-listen', { operation: 'guiTerminalLink', id: 'terminal', request: { type: 'listen' } });
  expect((await operations.execute(listen, 'relay', 'session', 'owner')).error).toContain('链接无效');
});

it('replays in-flight stream operations once and keeps long transfers from exhausting the retry cache', async () => {
  const operations = new ChatOperations(new RemoteTerminals());
  await operations.execute(request('open-stream-shell', { operation: 'guiTerminalOpen', cwd: '/remote', size: {} }));
  const stream = (id: string, action: object) => request(id, { operation: 'guiTerminalLink', id: 'terminal', request: action });
  vi.mocked(invoke).mockResolvedValue({ type: 'data', data: 'YQ==', eof: false });
  const read = stream('read-stream', { type: 'read', id: 'stream' });
  await operations.execute(read, 'relay'); await operations.execute(read, 'direct');
  expect(invoke).toHaveBeenCalledOnce();
  for (let index = 0; index < 600; index++) {
    const reply = await operations.execute(stream(`chunk-${index}`, { type: 'read', id: 'stream' }));
    expect(reply.error).toBeUndefined();
  }
  for (let index = 0; index < 600; index++) {
    vi.mocked(invoke).mockResolvedValueOnce({ type: 'socket', id: `stream-${index}` });
    const connect = await operations.execute(stream(`connect-${index}`, { type: 'connect', url: 'http://localhost:3002' }));
    expect(connect.error).toBeUndefined();
    const close = await operations.execute(stream(`close-${index}`, { type: 'close', id: `stream-${index}` }));
    expect(close.error).toBeUndefined();
  }
});

it('replays output by cursor and keeps the shell running when offline output exceeds the retained history', async () => {
  let receive!: (event: TerminalEvent) => void;
  vi.mocked(terminalApi.open).mockImplementation(async (_cwd, _size, listener) => {
    receive = listener; return { id: 'terminal', cwd: '/remote', shell: 'bash' };
  });
  const operations = new ChatOperations(new RemoteTerminals());
  await operations.execute(request('open', { operation: 'guiTerminalOpen', cwd: '/remote', size: {} }));
  receive({ type: 'output', data: [228, 184] });
  const read = request('read', { operation: 'guiTerminalRead', id: 'terminal', cursor: 0 });
  expect((await operations.execute(read)).data).toMatchObject({ cursor: 1,
    events: [{ type: 'output', data: [228, 184] }] });
  receive({ type: 'output', data: [173] });
  const next = await operations.execute(request('next', { ...read.body, cursor: 1 }));
  expect(next.data).toMatchObject({ cursor: 2, events: [{ type: 'output', data: [173] }] });
  expect((await operations.execute({ ...read, id: 'replay' })).data).toMatchObject({ cursor: 2,
    events: [{ type: 'output', data: [228, 184] }, { type: 'output', data: [173] }] });
  receive({ type: 'output', data: Array<number>(1024 * 1024).fill(1) });
  operations.release();
  expect(terminalApi.close).not.toHaveBeenCalled();
  let retained = 0;
  let cursor = 0;
  do {
    const result = (await operations.execute(request('overflow-' + cursor, { ...read.body, cursor }))).data as TerminalRead;
    if (!cursor) expect(result.truncated).toBe(true);
    if (!result.events.length) break;
    retained += result.events.reduce((bytes, event) => bytes + (event.type === 'output' ? event.data.length : 0), 0);
    cursor = result.cursor;
  } while (true);
  expect(retained).toBe(512 * 1024);
  operations.release();
});

it('retains a pending terminal if the phone disconnects before opening completes', async () => {
  let finish!: (info: { id: string; cwd: string; shell: string }) => void;
  vi.mocked(terminalApi.open).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const operations = new ChatOperations(new RemoteTerminals());
  const opening = operations.execute(request('open', { operation: 'guiTerminalOpen', cwd: '/remote', size: {} }));
  operations.release(); finish({ id: 'late', cwd: '/remote', shell: 'bash' }); await opening;
  expect(terminalApi.close).not.toHaveBeenCalled();
  expect((await operations.execute(request('list', { operation: 'guiTerminalList' }))).data)
    .toEqual([{ id: 'late', cwd: '/remote', shell: 'bash', projectCwd: '/remote' }]);
});

it('preserves legacy phone reads and retains completed shells until explicitly removed', async () => {
  let receive!: (event: TerminalEvent) => void;
  vi.mocked(terminalApi.open).mockImplementation(async (_cwd, _size, listener) => {
    receive = listener; return { id: 'terminal', cwd: '/remote', shell: 'bash' };
  });
  const operations = new ChatOperations(new RemoteTerminals());
  await operations.execute(request('open', { operation: 'guiTerminalOpen', cwd: '/remote', size: {} }));
  receive({ type: 'output', data: [65] });
  const legacy = request('legacy', { operation: 'guiTerminalRead', id: 'terminal' });
  expect((await operations.execute(legacy)).data).toEqual([{ type: 'output', data: [65] }]);
  receive({ type: 'exit', code: 0 });
  expect((await operations.execute(legacy)).data).toEqual([{ type: 'output', data: [65] }]);
  expect((await operations.execute({ ...legacy, id: 'exit' })).data).toEqual([{ type: 'exit', code: 0 }]);
  operations.release();
  expect((await operations.execute(request('list', { operation: 'guiTerminalList' }))).data).toHaveLength(1);
  const replay = await operations.execute(request('replay', { ...legacy.body, cursor: 0 }));
  expect(replay.data).toMatchObject({ events: [{ type: 'output', data: [65] }, { type: 'exit', code: 0 }] });
  expect(terminalApi.close).not.toHaveBeenCalled();
});

it('rejects updates and restarts while any remote conversation is running', async () => {
  state.conversations = { other: { activeTurn: 'turn' } };
  const operations = new ChatOperations();
  for (const operation of ['guiCliInstall', 'guiReconnect']) {
    const result = await operations.execute(request(operation, { operation, version: '0.156.0' }));
    expect(result.error).toContain('任务在运行');
  }
  expect(invoke).not.toHaveBeenCalled(); expect(guiApi.connect).not.toHaveBeenCalled();
});

it('returns the host cached update with status and remembers manually checked releases', async () => {
  const release = { version: '0.156.0', size: 100, ready: true };
  vi.mocked(invoke).mockResolvedValue({ version: '0.155.0', release });
  const operations = new ChatOperations();
  const result = await operations.execute(request('cached', { operation: 'guiCliStatus' }));
  expect(result.data).toMatchObject({ version: '0.155.0', release });
  expect(invoke).toHaveBeenCalledExactlyOnceWith('codex_gui_cli_status');
  await operations.execute(request('release', { operation: 'guiCliRelease' }));
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_cli_check');
});

it('returns an update job immediately, reports progress, and reconnects after completion', async () => {
  let finish!: () => void;
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'codex_gui_cli_install') await new Promise<void>(resolve => { finish = resolve; });
    return { version: '0.156.0' };
  });
  const operations = new ChatOperations();
  const result = await operations.execute(request('install', { operation: 'guiCliInstall', version: '0.156.0' }));
  expect(result.data).toMatchObject({ installing: true });
  const progress = { downloaded: 50, total: 100, phase: 'downloading' };
  vi.mocked(subscribeGuiEvent).mock.calls[0][1](progress);
  expect((await operations.execute(request('status', { operation: 'guiCliStatus' }))).data)
    .toMatchObject({ installing: true, progress });
  operations.release(); // The download is independent of the initiating connection.
  finish(); await flush();
  expect(guiApi.connect).toHaveBeenCalledOnce();
  expect((await operations.execute(request('done', { operation: 'guiCliStatus' }))).data)
    .toMatchObject({ installing: false, version: '0.156.0' });
});
