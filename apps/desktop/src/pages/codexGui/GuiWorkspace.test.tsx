// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuiWorkspace } from './GuiWorkspace';
import type { GuiCloudIdentity, GuiComputer } from '../../../../../shared/conversation/remote/types';
import type { ThreadNavigation } from './useNotificationNavigation';

const fixture = vi.hoisted(() => ({ current: null as GuiComputer | null, mounts: 0, stops: 0,
  identity: null as GuiCloudIdentity | null, active: true,
  notificationTarget: undefined as ThreadNavigation | undefined, choose: vi.fn(),
  remoteMounts: vi.fn(), remoteStops: vi.fn(), replies: new Map<string, (reply: string) => void>(),
  notify: (_message: string) => {} }));
vi.mock('../../api/backend', () => ({ isDesktopApp: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('./remote/useGuiComputers', () => ({ useGuiComputers: () => ({
  current: fixture.current, identity: fixture.identity, devices: [],
  choose: fixture.choose,
}) }));
vi.mock('./useGuiLayout', () => ({ useGuiLayout: () => ({ focused: false, onToggleFocus() {} }) }));
vi.mock('./useGuiAccountSelection', () => ({ useGuiAccountSelection: () => ({ accounts: [], providers: [] }) }));
vi.mock('./ProxyAccountPicker', () => ({ ProxyAccountPicker: () => null }));
vi.mock('./remote/RemoteGuiWorkspace', () => ({ default: function RemoteConversation({ device, active }: {
  device: GuiComputer; active: boolean;
}) {
  const [draft, setDraft] = useState(`draft for ${device.deviceId}`);
  const [reply, setReply] = useState('streaming');
  useEffect(() => {
    fixture.remoteMounts(device.deviceId); fixture.replies.set(device.deviceId, setReply);
    return () => { fixture.remoteStops(device.deviceId); fixture.replies.delete(device.deviceId); };
  }, [device.deviceId]);
  return <div data-remote-device={device.deviceId} data-active={active}>
    <input value={draft} onChange={event => setDraft(event.target.value)} /><output>{reply}</output>
  </div>;
} }));
vi.mock('../CodexGuiPage', () => ({ CodexGuiPage: function LocalConversation({ active }: { active: boolean }) {
  const [draft, setDraft] = useState('unfinished local draft');
  const [reply, setReply] = useState('streaming');
  useEffect(() => {
    fixture.mounts++; fixture.notify = setReply;
    return () => { fixture.stops++; fixture.notify = () => {}; };
  }, []);
  return <div data-local-active={active}><input value={draft} onChange={event => setDraft(event.target.value)} />
    <output>{reply}</output></div>;
} }));

let root: Root;
let host: HTMLDivElement;
const render = () => act(async () => root.render(<GuiWorkspace active={fixture.active} accounts={[]} providers={[]}
  notificationTarget={fixture.notificationTarget}
  privacyMode={false} loading={false} plugins={{ authenticated: true, baseUrl: 'https://fixture.test',
    currentUserId: 'owner', onLogin() {}, notify() {}, t: text => text }} />));
const office: GuiComputer = { deviceId: 'one', name: 'Office', platform: 'windows', online: true };
const home: GuiComputer = { ...office, deviceId: 'two', name: 'Home' };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.current = null; fixture.mounts = 0; fixture.stops = 0; fixture.active = true;
  fixture.notificationTarget = undefined;
  fixture.choose.mockReset().mockImplementation((device: GuiComputer | null) => { fixture.current = device; });
  fixture.identity = { baseUrl: 'https://fixture.test', userId: 'owner' };
  fixture.remoteMounts.mockClear(); fixture.remoteStops.mockClear(); fixture.replies.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('returns to the local host for a notification without preventing later remote host selection', async () => {
  fixture.current = office; await render();
  fixture.notificationTarget = { requestId: 'click', threadId: 'local-thread' };
  await render(); await render();
  expect(fixture.choose).toHaveBeenCalledExactlyOnceWith(null);
  expect(host.querySelector('[data-local-active="true"]')).not.toBeNull();
  fixture.current = home; await render();
  expect(fixture.choose).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-local-active="false"]')).not.toBeNull();
});

it('keeps the local conversation mounted, receiving replies and preserving its draft across remote switches', async () => {
  await render();
  const local = host.querySelector('[data-local-active]')!;
  fixture.current = { deviceId: 'one', name: 'Office', platform: 'windows', online: true };
  await render();
  expect(local.closest('[hidden]')).not.toBeNull();
  await act(async () => fixture.notify('reply received while viewing remote computer'));
  fixture.current = { ...fixture.current, deviceId: 'two' }; await render();
  expect(fixture.mounts).toBe(1); expect(fixture.stops).toBe(0);
  fixture.current = null; await render();
  expect(host.querySelector('[data-local-active]')).toBe(local);
  expect(local.closest('[hidden]')).toBeNull();
  expect(local.querySelector('output')?.textContent).toBe('reply received while viewing remote computer');
  expect(local.querySelector('input')?.value).toBe('unfinished local draft');
  expect(fixture.stops).toBe(0);
});

it('keeps remote conversations connected and receiving replies across local and remote switches', async () => {
  await render();
  expect(fixture.remoteMounts).not.toHaveBeenCalled();
  fixture.current = office; await render();
  const officeView = host.querySelector('[data-remote-device="one"]')!;
  fixture.current = home; await render();
  expect(officeView.closest('[hidden]')).not.toBeNull();
  expect(officeView.getAttribute('data-active')).toBe('false');
  const homeView = host.querySelector('[data-remote-device="two"]')!;
  await act(async () => fixture.replies.get('one')?.('office reply while viewing home'));
  fixture.current = null; await render();
  expect(homeView.closest('[hidden]')).not.toBeNull();
  await act(async () => fixture.replies.get('two')?.('home reply while viewing local'));
  for (const device of [office, home, office]) {
    fixture.current = { ...device }; await render();
    const view = host.querySelector(`[data-remote-device="${device.deviceId}"]`)!;
    expect(view).toBe(device === office ? officeView : homeView);
    expect(view.closest('[hidden]')).toBeNull();
    expect(view.getAttribute('data-active')).toBe('true');
    expect(view.querySelector('input')?.value).toBe(`draft for ${device.deviceId}`);
  }
  expect(officeView.querySelector('output')?.textContent).toBe('office reply while viewing home');
  expect(homeView.querySelector('output')?.textContent).toBe('home reply while viewing local');
  expect(fixture.remoteMounts.mock.calls.flat()).toEqual(['one', 'two']);
  expect(fixture.remoteStops).not.toHaveBeenCalled();
  fixture.active = false; await render();
  expect(officeView.getAttribute('data-active')).toBe('false');
  expect(fixture.remoteStops).not.toHaveBeenCalled();
});

it.each(['logout', 'owner', 'server'] as const)('releases all remote connections on cloud %s changes', async change => {
  fixture.current = office; await render();
  fixture.current = home; await render();
  fixture.current = null;
  if (change === 'logout') fixture.identity = null;
  else if (change === 'owner') fixture.identity = { ...fixture.identity!, userId: 'another-owner' };
  else fixture.identity = { ...fixture.identity!, baseUrl: 'https://another.test' };
  await render();
  expect(fixture.remoteStops.mock.calls.flat()).toEqual(['one', 'two']);
  expect(host.querySelectorAll('[data-remote-device]')).toHaveLength(0);
  fixture.identity = { baseUrl: 'https://fixture.test', userId: 'owner' };
  fixture.current = office; await render();
  expect(fixture.remoteMounts.mock.calls.flat()).toEqual(['one', 'two', 'one']);
});
