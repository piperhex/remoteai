// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useRemoteTerminalLauncher } from '../../../../shared/remote-chat/useRemoteTerminalLauncher';
import type { TerminalInfo } from '../../../../shared/terminal/types';

const info = { id: 'retained', cwd: '/project', shell: 'bash' };
function fixture() {
  const client = { list: vi.fn(async (): Promise<TerminalInfo[]> => []),
    open: vi.fn(async () => info), close: vi.fn(async () => {}),
    read: vi.fn(async () => ({ found: true, cursor: 0, truncated: false, events: [] })),
    write: vi.fn(async () => {}), resize: vi.fn(async () => {}) };
  const root = createRoot(document.createElement('div'));
  let panel!: ReturnType<typeof useRemoteTerminalLauncher>;
  function Fixture({ connected, cwd }: { connected: boolean; cwd: string }) {
    panel = useRemoteTerminalLauncher({ client, cwd, connected }); return null;
  }
  return { client, panel: () => panel, dispose: () => act(async () => root.unmount()),
    render: (connected = true, cwd = info.cwd) => act(async () => root.render(<Fixture connected={connected} cwd={cwd} />)) };
}
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('retains opened tools and their selected terminals across projects until explicit close', async () => {
  const test = fixture();
  test.client.list.mockResolvedValue([info]);
  try {
    await test.render();
    await act(async () => test.panel().show());
    await act(async () => test.panel().hide());
    expect(test.panel().opened).toBe(true);
    expect(test.panel().open).toBe(false);
    await test.render(false, '/another');
    expect(test.panel().opened).toBe(false);
    expect(test.panel().anyOpened).toBe(true);
    await test.render(false);
    expect(test.panel().selected).toBe(info.id);
    expect(test.panel().opened).toBe(true);
    await act(async () => test.panel().show());
    expect(test.panel().open).toBe(true);
    await act(async () => { test.panel().hide(); test.panel().show(); });
    expect(test.panel().open).toBe(true);
    expect(test.client.open).not.toHaveBeenCalled();
    await act(async () => test.panel().close());
    expect(test.panel().opened).toBe(false);
    expect(test.panel().anyOpened).toBe(false);
    expect(test.panel().open).toBe(false);
  } finally { await test.dispose(); }
});

it('keeps background errors closed and opens their details while offline without retrying', async () => {
  const test = fixture();
  test.client.list.mockRejectedValue(new Error('Offline'));
  try {
    await test.render();
    const error = test.panel().error;
    expect(error).not.toBe('');
    expect(test.panel().open).toBe(false);
    await test.render(false);
    await act(async () => test.panel().toggle());
    expect(test.panel().open).toBe(true);
    expect(test.panel().error).toBe(error);
    expect(test.client.list).toHaveBeenCalledOnce();
    await act(async () => test.panel().hide());
    expect(test.panel().open).toBe(false);
    expect(test.panel().error).toBe(error);
    await act(async () => test.panel().toggle());
    await test.render(false, '/another');
    expect(test.panel().open).toBe(false);
    expect(test.panel().error).toBe('');
  } finally { await test.dispose(); }
});

it('shows an opening failure in the drawer and retries by restoring an existing shell', async () => {
  const test = fixture();
  try {
    await test.render();
    test.client.list.mockRejectedValueOnce(new Error('Unavailable'));
    await act(async () => test.panel().toggle());
    expect(test.panel().open).toBe(true);
    expect(test.panel().error).not.toBe('');
    test.client.list.mockResolvedValue([info]);
    await act(async () => test.panel().retry());
    expect(test.panel().open).toBe(true);
    expect(test.panel().error).toBe('');
    expect(test.panel().tabs[0].session).toEqual(info);
    expect(test.client.open).not.toHaveBeenCalled();
    await act(async () => test.panel().remove(info.id));
    expect(test.panel().open).toBe(false);
  } finally { await test.dispose(); }
});

it('shows a failed file-browser launch and retries in the requested directory', async () => {
  const test = fixture();
  const directory = '/project/src';
  test.client.open.mockRejectedValueOnce(new Error('Unavailable'));
  test.client.open.mockResolvedValue({ ...info, cwd: directory });
  try {
    await test.render();
    await act(async () => test.panel().addInDirectory(directory));
    expect(test.panel().open).toBe(true);
    expect(test.panel().error).not.toBe('');
    await act(async () => test.panel().retry());
    expect(test.client.open).toHaveBeenLastCalledWith(directory, { cols: 80, rows: 24 }, info.cwd);
    expect(test.panel().open).toBe(true);
    expect(test.panel().error).toBe('');
    expect(test.panel().tabs[0].cwd).toBe(directory);
  } finally { await test.dispose(); }
});

it('keeps a dismissed loading drawer closed when a late shell opens and reuses it on the next click', async () => {
  const test = fixture();
  let finish!: (session: TerminalInfo) => void;
  test.client.open.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  try {
    await test.render();
    await act(async () => test.panel().toggle());
    expect(test.panel().busy).toBe(true);
    expect(test.panel().open).toBe(true);
    await act(async () => test.panel().hide());
    await act(async () => finish(info));
    expect(test.panel().open).toBe(false);
    expect(test.client.close).not.toHaveBeenCalled();
    await act(async () => test.panel().toggle());
    expect(test.panel().open).toBe(true);
    expect(test.client.open).toHaveBeenCalledOnce();
    await act(async () => test.panel().remove(info.id));
    expect(test.panel().open).toBe(false);
  } finally { await test.dispose(); }
});
