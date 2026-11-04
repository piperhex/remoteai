// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNotificationNavigation, useOpenNotifiedThread, type ThreadNavigation } from './useNotificationNavigation';

const fixture = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), stop: vi.fn(), open: vi.fn(),
  filter: vi.fn(), select: vi.fn(), show: vi.fn(), clicked: () => {},
}));
vi.mock('../../api/backend', () => ({ isDesktopApp: true, invoke: fixture.invoke }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('@tauri-apps/api/event', () => ({ listen: fixture.listen }));

let root: Root;
let host: HTMLDivElement;
const controller = { filter: fixture.filter, select: fixture.select };
function Workspace({ ready }: { ready: boolean }) {
  const target = useNotificationNavigation(fixture.open);
  useOpenNotifiedThread({ target, ready, controller, showConversation: fixture.show });
  return <output>{target?.threadId}</output>;
}
const render = (ready: boolean) => act(async () => root.render(<Workspace ready={ready} />));
const click = () => act(async () => fixture.clicked());
const target = (threadId: string, requestId = threadId): ThreadNavigation => ({ threadId, requestId });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  fixture.invoke.mockResolvedValue(null);
  fixture.select.mockResolvedValue(undefined);
  fixture.listen.mockImplementation(async (_event, callback: () => void) => {
    fixture.clicked = callback; return fixture.stop;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

it('retains a cold startup click until connected, then clears filters and opens the conversation view', async () => {
  fixture.invoke.mockResolvedValueOnce(target('startup-thread'));
  await render(false);
  expect(fixture.listen).toHaveBeenCalledWith('codex-gui-open-thread', expect.any(Function));
  expect(fixture.invoke).toHaveBeenCalledWith('codex_gui_take_notification_navigation');
  expect(fixture.open).toHaveBeenCalledOnce();
  expect(fixture.select).not.toHaveBeenCalled();
  await render(true);
  expect(fixture.show).toHaveBeenCalledOnce();
  expect(fixture.filter).toHaveBeenCalledWith('', false);
  expect(fixture.select).toHaveBeenCalledWith('startup-thread');
  await render(false); await render(true);
  expect(fixture.select).toHaveBeenCalledOnce();
});

it('opens each clicked thread, including another click on the same thread after navigating away', async () => {
  await render(true);
  for (const next of [target('first'), target('second'), target('first', 'repeat')]) {
    fixture.invoke.mockResolvedValueOnce(next); await click();
    expect(fixture.select).toHaveBeenLastCalledWith(next.threadId);
  }
  expect(fixture.select).toHaveBeenCalledTimes(3);
  expect(fixture.show).toHaveBeenCalledTimes(3);
});

it('drains a click arriving during startup without overlapping reads or losing the latest target', async () => {
  let finish!: (value: ThreadNavigation) => void;
  fixture.invoke.mockImplementationOnce(() => new Promise<ThreadNavigation>(resolve => { finish = resolve; }));
  await render(false);
  fixture.invoke.mockResolvedValueOnce(target('latest'));
  await click(); await click();
  expect(fixture.invoke).toHaveBeenCalledOnce();
  await act(async () => finish(target('earlier')));
  expect(fixture.invoke).toHaveBeenCalledTimes(2);
  await render(true);
  expect(fixture.select).toHaveBeenCalledExactlyOnceWith('latest');
});

it('cleans up listeners and ignores late results after unmount', async () => {
  let finish!: (value: ThreadNavigation) => void;
  fixture.invoke.mockImplementationOnce(() => new Promise<ThreadNavigation>(resolve => { finish = resolve; }));
  await render(true);
  await act(async () => root.unmount());
  expect(fixture.stop).toHaveBeenCalledOnce();
  await act(async () => finish(target('late')));
  expect(fixture.open).not.toHaveBeenCalled();
  expect(fixture.select).not.toHaveBeenCalled();
});
