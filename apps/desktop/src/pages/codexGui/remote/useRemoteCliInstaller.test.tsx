// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGuiToolsClient, type RemoteCliStatus } from '../../../../../../shared/remote-chat/guiTools';
import { useRemoteCliInstaller } from '../../../../../../shared/conversation/remote/useRemoteCliInstaller';

const request = vi.fn();
const client = createGuiToolsClient(request);
let installer: ReturnType<typeof useRemoteCliInstaller>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function Fixture({ active = true }: { active?: boolean }) {
  installer = useRemoteCliInstaller(client, active); return null;
}
const status: RemoteCliStatus = { version: '0.155.0', installing: false, progress: null, error: '' };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); request.mockReset();
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('does not overlap slow status reads and cancels refreshes while inactive', async () => {
  let finish!: (value: RemoteCliStatus) => void;
  request.mockImplementation(() => new Promise<RemoteCliStatus>(resolve => { finish = resolve; }));
  await act(async () => root.render(<Fixture />));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(request).toHaveBeenCalledOnce();
  await act(async () => root.render(<Fixture active={false} />));
  await act(async () => { finish(status); await vi.advanceTimersByTimeAsync(30_000); });
  expect(request).toHaveBeenCalledOnce(); expect(installer.checked).toBe(false);
});

it('checks and installs on the remote computer and follows progress until completion', async () => {
  let installing = false;
  request.mockImplementation(async ({ operation }) => {
    if (operation === 'guiCliRelease') return { version: '0.156.0', size: 100 };
    if (operation === 'guiCliInstall') installing = true;
    return { ...status, installing, progress: installing ? { downloaded: 50, total: 100, phase: 'downloading' } : null };
  });
  await act(async () => root.render(<Fixture />));
  await act(async () => installer.check());
  await act(async () => installer.install());
  expect(request).toHaveBeenCalledWith({ operation: 'guiCliInstall', version: '0.156.0' });
  expect(installer.installing).toBe(true); expect(installer.progress?.downloaded).toBe(50);
  installing = false;
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(installer.installing).toBe(false);
});

it('observes host updates and retains the completed release after automatic installation', async () => {
  const release = { version: '0.156.0', size: 100, ready: false };
  request.mockResolvedValue({ ...status, release });
  await act(async () => root.render(<Fixture />));
  expect(installer.release).toEqual(release);
  expect(request.mock.calls.every(([body]) => body.operation === 'guiCliStatus')).toBe(true);
  request.mockResolvedValue({ ...status, release: { ...release, ready: true } });
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(installer.release?.ready).toBe(true);
  request.mockResolvedValue({ ...status, version: release.version, release: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(installer.version).toBe(release.version);
  expect(installer.release?.version).toBe(installer.version);
  await act(async () => installer.install());
  expect(request.mock.calls.every(([body]) => body.operation === 'guiCliStatus')).toBe(true);
});

it('does not let an older status read erase a manually discovered update', async () => {
  const release = { version: '0.156.0', size: 100 };
  let finish!: (value: RemoteCliStatus) => void;
  request.mockImplementation(({ operation }) => operation === 'guiCliRelease' ? Promise.resolve(release)
    : new Promise<RemoteCliStatus>(resolve => { finish = resolve; }));
  await act(async () => root.render(<Fixture />));
  await act(async () => installer.check());
  await act(async () => finish({ ...status, release: null }));
  expect(installer.release).toEqual(release);
});

it('clears a withdrawn pending update instead of preserving an installable stale release', async () => {
  request.mockResolvedValue({ ...status, release: { version: '0.156.0', size: 100 } });
  await act(async () => root.render(<Fixture />));
  request.mockResolvedValue({ ...status, release: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(installer.release).toBeNull();
  await act(async () => installer.install());
  expect(request.mock.calls.every(([body]) => body.operation === 'guiCliStatus')).toBe(true);
});

it('ignores a delayed status requested while the manual update check is still running', async () => {
  const release = { version: '0.156.0', size: 100 };
  request.mockResolvedValue({ ...status, release: null });
  await act(async () => root.render(<Fixture />));
  let finishCheck!: (value: typeof release) => void;
  let finishStatus!: (value: RemoteCliStatus) => void;
  request.mockImplementation(({ operation }) => operation === 'guiCliRelease'
    ? new Promise<typeof release>(resolve => { finishCheck = resolve; })
    : new Promise<RemoteCliStatus>(resolve => { finishStatus = resolve; }));
  await act(async () => { void installer.check(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  await act(async () => finishCheck(release));
  await act(async () => finishStatus({ ...status, release: null }));
  expect(installer.release).toEqual(release);
});
