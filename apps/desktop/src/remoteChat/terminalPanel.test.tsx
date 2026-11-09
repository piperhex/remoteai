// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useRemoteTerminalPanel } from '../../../../shared/remote-chat/useRemoteTerminalPanel';
import type { TerminalInfo } from '../../../../shared/terminal/types';

const info = { id: 'retained', cwd: '/original-project', shell: 'bash' };
function fixture() {
  const client = { list: vi.fn(async (): Promise<TerminalInfo[]> => [info]),
    open: vi.fn(async () => ({ ...info, id: 'new' })), close: vi.fn(async () => {}),
    read: vi.fn(async () => ({ found: true, cursor: 0, truncated: false, events: [] })),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}) };
  const root = createRoot(document.createElement('div'));
  let panel!: ReturnType<typeof useRemoteTerminalPanel>;
  function Fixture({ connected, cwd }: { connected: boolean; cwd: string }) {
    panel = useRemoteTerminalPanel({ client, cwd, connected }); return null;
  }
  return { client, panel: () => panel, root,
    render: (connected = true, cwd = info.cwd) => act(async () => root.render(<Fixture connected={connected} cwd={cwd} />)) };
}
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.restoreAllMocks());

it('refreshes hidden scripts without overlapping reads and stops refreshing after completion', async () => {
  vi.useFakeTimers();
  const test = fixture();
  const script = { ...info, npmScript: 'dev' };
  test.client.list.mockResolvedValue([script]);
  try {
    await test.render();
    let finish!: (sessions: TerminalInfo[]) => void;
    test.client.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(test.client.list).toHaveBeenCalledTimes(2);
    expect(test.panel().open).toBe(false);
    await act(async () => finish([{ ...script, exited: true }]));
    expect(test.panel().tabs[0].exited).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(test.client.list).toHaveBeenCalledTimes(2);
  } finally { await act(async () => test.root.unmount()); vi.useRealTimers(); }
});

it('ignores a script status refresh that finishes after disconnecting', async () => {
  vi.useFakeTimers();
  const test = fixture();
  test.client.list.mockResolvedValue([{ ...info, npmScript: 'dev' }]);
  try {
    await test.render();
    let finish!: (sessions: TerminalInfo[]) => void;
    test.client.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    await test.render(false);
    await act(async () => finish([]));
    expect(test.panel().tabs).toHaveLength(1);
  } finally { await act(async () => test.root.unmount()); vi.useRealTimers(); }
});

it('refreshes npm completion after reconnect and avoids starting another copy of a running script', async () => {
  const test = fixture();
  const script: TerminalInfo = { ...info, npmScript: 'dev', npmScriptCwd: info.cwd };
  test.client.list.mockResolvedValue([script]);
  try {
    await test.render();
    await act(async () => test.panel().addInDirectory(info.cwd, 'dev'));
    expect(test.client.open).not.toHaveBeenCalled();
    expect(test.panel().selected).toBe(script.id);
    await test.render(false);
    test.client.list.mockResolvedValue([{ ...script, exited: true }]);
    await test.render(true);
    expect(test.panel().tabs[0].exited).toBe(true);
    await act(async () => test.panel().addInDirectory(info.cwd, 'dev'));
    expect(test.client.open).toHaveBeenCalledWith(info.cwd, { cols: 80, rows: 24 }, info.cwd, { npmScript: 'dev' });
  } finally { await act(async () => test.root.unmount()); }
});

it('restores the PC list after remount, hides without closing, and closes only on explicit removal', async () => {
  const test = fixture();
  try {
    await test.render();
    expect(test.panel().tabs[0].session).toEqual(info);
    await act(async () => test.panel().toggle());
    expect(test.panel().open).toBe(true);
    await act(async () => test.panel().hide());
    expect(test.client.close).not.toHaveBeenCalled();
    expect(test.client.open).not.toHaveBeenCalled();
    await act(async () => test.panel().remove(info.id));
    expect(test.client.close).toHaveBeenCalledWith(info.id);
    expect(test.panel().tabs).toEqual([]);
  } finally { await act(async () => test.root.unmount()); }
});

it('keeps failed close actions visible and discovers shells created while the phone was disconnected', async () => {
  const test = fixture();
  try {
    await test.render();
    test.client.close.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => test.panel().remove(info.id));
    expect(test.panel().error).not.toBe('');
    expect(test.panel().tabs).toHaveLength(1);
    await test.render(false);
    test.client.list.mockResolvedValue([info, { ...info, id: 'another' }]);
    await test.render();
    expect(test.panel().tabs.map(tab => tab.id)).toEqual(['retained', 'another']);
    expect(test.client.open).not.toHaveBeenCalled();
  } finally { await act(async () => test.root.unmount()); }
});

it('closes every requested shell sequentially while preserving a surviving selection', async () => {
  const test = fixture();
  const sessions = [info, { ...info, id: 'second' }, { ...info, id: 'third' }];
  test.client.list.mockResolvedValue(sessions);
  let finish!: () => void;
  test.client.close.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    await test.render();
    await act(async () => { test.panel().toggle(); test.panel().select(info.id); });
    await act(async () => test.panel().removeTabs(['second', 'third']));
    expect(test.client.close).toHaveBeenCalledExactlyOnceWith('second');
    expect(test.panel().busy).toBe(true);
    await act(async () => finish());
    expect(test.client.close.mock.calls).toEqual([['second'], ['third']]);
    expect(test.panel().tabs.map(tab => tab.id)).toEqual([info.id]);
    expect(test.panel().selected).toBe(info.id);
    expect(test.panel().open).toBe(true);
    expect(test.panel().busy).toBe(false);
  } finally { await act(async () => test.root.unmount()); }
});

it('preserves failed and unattempted shells after a partial group close', async () => {
  const test = fixture();
  const sessions = [info, { ...info, id: 'second' }, { ...info, id: 'third' }];
  test.client.list.mockResolvedValue(sessions);
  test.client.close.mockRejectedValueOnce(new Error('Offline'));
  try {
    await test.render();
    await act(async () => test.panel().removeTabs(['second', 'third']));
    expect(test.panel().tabs.map(tab => tab.id)).toEqual(sessions.map(session => session.id));
    expect(test.panel().error).not.toBe('');
    expect(test.client.close).toHaveBeenCalledExactlyOnceWith('second');
    test.client.close.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Offline'));
    await act(async () => test.panel().removeTabs(['second', 'third']));
    expect(test.panel().tabs.map(tab => tab.id)).toEqual([info.id, 'third']);
    expect(test.panel().selected).toBe('third');
    expect(test.panel().error).not.toBe('');
  } finally { await act(async () => test.root.unmount()); }
});

it('does not let a stale initial list replace a newly opened terminal', async () => {
  const test = fixture();
  let finish!: (sessions: TerminalInfo[]) => void;
  test.client.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  test.client.list.mockResolvedValue([]);
  try {
    await test.render();
    await act(async () => test.panel().toggle());
    expect(test.client.open).toHaveBeenCalledOnce();
    await act(async () => finish([]));
    expect(test.panel().tabs[0].id).toBe('new');
    await act(async () => test.root.unmount());
    expect(test.client.close).not.toHaveBeenCalled();
  } finally { await act(async () => test.root.unmount()); }
});

it('adds a directory shell without replacing an existing shell and restores it after reconnecting', async () => {
  const test = fixture();
  const directory = `${info.cwd}/src`;
  const opened = { ...info, id: 'new', cwd: directory, projectCwd: info.cwd };
  test.client.open.mockResolvedValue(opened);
  try {
    await test.render();
    await act(async () => test.panel().addInDirectory(directory));
    expect(test.client.open).toHaveBeenCalledWith(directory, { cols: 80, rows: 24 }, info.cwd);
    expect(test.panel().tabs.map(tab => tab.id)).toEqual([info.id, opened.id]);
    expect(test.panel().selected).toBe(opened.id);
    expect(test.panel().open).toBe(true);
    await test.render(false);
    test.client.list.mockResolvedValue([info, opened]);
    await test.render();
    expect(test.panel().tabs.map(tab => tab.cwd)).toEqual([info.cwd, directory]);
    expect(test.client.close).not.toHaveBeenCalled();
  } finally { await act(async () => test.root.unmount()); }
});

it('switches project views without closing shells and filters lists from older PCs', async () => {
  const test = fixture();
  const other = { ...info, id: 'other', cwd: '/other-project' };
  test.client.list.mockResolvedValue([info, other]);
  try {
    await test.render();
    await act(async () => test.panel().toggle());
    expect(test.panel().tabs.map(tab => tab.id)).toEqual([info.id]);
    await test.render(true, other.cwd);
    expect(test.client.list).toHaveBeenLastCalledWith(other.cwd);
    expect(test.panel().tabs.map(tab => tab.id)).toEqual([other.id]);
    expect(test.panel().open).toBe(false);
    await act(async () => test.panel().toggle());
    await test.render(true, info.cwd);
    expect(test.panel().tabs.map(tab => tab.id)).toEqual([info.id]);
    expect(test.client.open).not.toHaveBeenCalled();
    expect(test.client.close).not.toHaveBeenCalled();
  } finally { await act(async () => test.root.unmount()); }
});

it('ignores late lists and failures from a project that is no longer selected', async () => {
  const test = fixture();
  let finish!: (sessions: TerminalInfo[]) => void;
  let fail!: (error: Error) => void;
  test.client.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  test.client.list.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  try {
    await test.render();
    await test.render(true, '/other');
    await test.render(true, '/empty');
    await act(async () => { finish([info]); fail(new Error('old failure')); });
    expect(test.panel().tabs).toEqual([]);
    expect(test.panel().error).toBe('');
  } finally { await act(async () => test.root.unmount()); }
});

it('keeps a late open on its original project while allowing the next project to open immediately', async () => {
  const test = fixture();
  let finish!: (session: TerminalInfo) => void;
  test.client.list.mockResolvedValue([]);
  test.client.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const other = { ...info, id: 'other', cwd: '/other' };
  test.client.open.mockResolvedValue(other);
  try {
    await test.render();
    await act(async () => test.panel().toggle());
    expect(test.panel().busy).toBe(true);
    await test.render(true, '/other');
    expect(test.panel().busy).toBe(false);
    await act(async () => test.panel().toggle());
    await act(async () => finish(info));
    expect(test.panel().tabs.map(tab => tab.id)).toEqual([other.id]);
    expect(test.panel().selected).toBe(other.id);
    expect(test.client.close).not.toHaveBeenCalled();
    test.client.list.mockResolvedValue([info, other]);
    await test.render();
    expect(test.panel().tabs.map(tab => tab.id)).toEqual([info.id]);
    expect(test.client.open).toHaveBeenCalledTimes(2);
  } finally { await act(async () => test.root.unmount()); }
});

it('keeps pending close results out of the next project and clears the old view even while offline', async () => {
  const test = fixture();
  let finish!: () => void;
  test.client.close.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    await test.render();
    await act(async () => test.panel().removeTabs([info.id, 'unattempted']));
    await test.render(false, '/offline');
    expect(test.panel().tabs).toEqual([]);
    expect(test.panel().busy).toBe(false);
    const other = { ...info, id: 'other', cwd: '/other' };
    test.client.list.mockResolvedValue([other]);
    await test.render(true, other.cwd);
    await act(async () => { test.panel().toggle(); finish(); });
    expect(test.panel().selected).toBe(other.id);
    expect(test.panel().open).toBe(true);
    expect(test.client.close).toHaveBeenCalledExactlyOnceWith(info.id);
  } finally { await act(async () => test.root.unmount()); }
});
