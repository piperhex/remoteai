// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RemoteAssistance } from './RemoteAssistance';
import { AssistanceButton } from './AssistanceButton';
import { assistanceStore } from './store';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('./AssistanceViewer', () => ({ AssistanceViewer: () => <div data-testid="viewer">远程桌面已打开</div> }));
let host: HTMLDivElement, root: Root;
const auth = { authenticated: true, enabled: true, sessionExpired: false, userId: 'helper', baseUrl: 'https://test' };
const invitation = { id: 'invite', hostDeviceId: 'host', hostName: '对方的电脑', hostEmail: 'host@example.com',
  helperEmail: 'helper@example.com', expiresAt: '2099-01-01T00:00:00Z', state: 'pending' };
const directory = { identity: { baseUrl: 'https://test', userId: 'helper' }, currentDeviceId: 'helper', requests: [] };
const click = async (text: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(node => node.textContent?.replace(/\s/g, '') === text);
  expect(button).toBeTruthy(); await act(async () => button!.click());
};
beforeEach(() => {
  invoke.mockReset(); assistanceStore.reset(false);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => computedStyle(element));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); assistanceStore.reset(false);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('opens a compact invitation dialog from the local toolbar and requests login when signed out', async () => {
  const login = vi.fn();
  await act(async () => root.render(<><AssistanceButton />
    <RemoteAssistance auth={{ ...auth, authenticated: false }} onLogin={login} /></>));
  await click('远程协助');
  expect(document.body.textContent).toContain('邀请对方查看并操作本机');
  expect((document.querySelector('.ant-modal-body') as HTMLElement).style.maxWidth).toBe('400px');
  await click('登录后使用');
  expect(login).toHaveBeenCalledOnce();
});

it('shows an incoming request outside the GUI and opens the desktop after explicit acceptance', async () => {
  invoke.mockResolvedValueOnce({ ...directory, requests: [invitation] });
  await act(async () => root.render(<RemoteAssistance auth={auth} onLogin={vi.fn()} />));
  expect(document.body.textContent).toContain('host@example.com');
  expect(document.querySelector('[data-testid="viewer"]')).toBeNull();
  invoke.mockResolvedValueOnce({ ...directory,
    requests: [{ ...invitation, state: 'accepted', helperDeviceId: 'helper' }] });
  await click('接受并连接');
  expect(invoke).toHaveBeenLastCalledWith('remote_assistance', {
    request: { kind: 'respond', id: 'invite', action: 'accept' },
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(document.querySelector('[data-testid="viewer"]')).not.toBeNull();
});

it('declines without opening a remote desktop and cleans up on logout', async () => {
  invoke.mockResolvedValueOnce({ ...directory, requests: [invitation] });
  await act(async () => root.render(<RemoteAssistance auth={auth} onLogin={vi.fn()} />));
  invoke.mockResolvedValueOnce({ ...directory, requests: [{ ...invitation, state: 'declined' }] });
  await click('拒绝');
  expect(document.querySelector('[data-testid="viewer"]')).toBeNull();
  await act(async () => root.render(<RemoteAssistance auth={{ ...auth, authenticated: false }} onLogin={vi.fn()} />));
  expect(assistanceStore.snapshot().requests).toEqual([]);
});

it.each(['helper@example.com', 'missing@example.com'])(
  'shows the same requesting state for %s without looking up the recipient', async email => {
    invoke.mockResolvedValueOnce({ ...directory, currentDeviceId: 'host' });
    await act(async () => root.render(<><AssistanceButton />
      <RemoteAssistance auth={auth} onLogin={vi.fn()} /></>));
    await click('远程协助');
    const input = document.querySelector<HTMLInputElement>('#assistance-email')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, email);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    invoke.mockResolvedValueOnce({ enabled: true, control: true });
    invoke.mockResolvedValueOnce({ ...directory, currentDeviceId: 'host',
      requests: [{ ...invitation, helperEmail: email }] });
    await click('发送邀请');
    expect(document.querySelector('[role="status"]')?.textContent).toContain('正在请求');
    expect(document.body.textContent).toContain('取消邀请');
    expect(document.body.textContent).not.toMatch(/账户不存在|用户不存在|未注册|对方离线/);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'remote_assistance', 'remote_desktop_permissions', 'remote_assistance',
    ]);
    expect(invoke).toHaveBeenLastCalledWith('remote_assistance', { request: { kind: 'invite', email } });
  },
);
