// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GuiAccountsClient, GuiAccountsSnapshot } from '../../../../../../shared/remote-chat/guiAccounts';
import { RemoteAccountPicker } from '../../../../../../shared/conversation/remote/RemoteAccountPicker';
import type { GuiComputerNavigation } from '../../../../../../shared/conversation/remote/types';

let root: Root;
let container: HTMLDivElement;
let client: GuiAccountsClient;
let ready: boolean;
let active: boolean;
let privacyMode: boolean;
let computers: GuiComputerNavigation;
const accountSnapshot: GuiAccountsSnapshot = { running: true, selection: { kind: 'account', id: 'remote-account' },
  choices: [{ kind: 'account', id: 'remote-account', name: 'remote@example.com',
    detail: 'Plus · 主剩余 28% · 次剩余 63%', plan: 'Plus', primaryRemainingPercent: 28,
    secondaryRemainingPercent: 63, available: true },
    { kind: 'provider', id: 'remote-provider', name: 'Remote Provider', detail: 'Model', available: true }] };
function Harness() { return <RemoteAccountPicker active={active} ready={ready} client={client} computers={computers}
  privacyMode={privacyMode} />; }
const render = () => act(async () => root.render(<Harness />));
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (target: HTMLButtonElement) => act(async () => target.click());
const accountList = () => document.querySelector('section[aria-label="账户列表"]')!;
const searchInput = () => document.querySelector<HTMLInputElement>('input[aria-label="搜索账号或 Provider"]')!;
const escape = (target: HTMLElement) => act(async () => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});
const search = (value: string) => act(async () => {
  const input = searchInput();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
async function accounts() {
  await click(container.querySelector('button')!);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => original(element));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  ready = true;
  active = true;
  privacyMode = false;
  client = { read: vi.fn().mockResolvedValue(accountSnapshot), select: vi.fn().mockResolvedValue({ kind: 'provider',
    id: 'remote-provider' }), subscribe: vi.fn().mockReturnValue(vi.fn()) };
  const current = { deviceId: 'work-pc', name: 'Work PC', online: true, platform: 'windows' };
  computers = { current, devices: [current, { ...current, deviceId: 'offline', name: 'Offline PC', online: false }],
    authenticated: true, loading: false, error: '', choose: vi.fn(), refresh: vi.fn(), login: vi.fn() };
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('shows the remote primary quota and plan using the compact local summary layout', async () => {
  privacyMode = true;
  await render();
  const progress = container.querySelector('[role="progressbar"]')!;
  expect(progress.getAttribute('aria-label')).toBe('主用量剩余');
  expect(progress.getAttribute('aria-valuenow')).toBe('28');
  expect(progress.querySelector('span')?.style.width).toBe('28%');
  expect(container.textContent).toContain('28%');
  expect(container.textContent).toContain('Plus');
  expect(container.textContent).not.toContain('Work PC');
  expect(container.querySelector('button svg')).toBeNull();
  expect(container.textContent).not.toContain('次剩余');
  expect(container.innerHTML).not.toContain('remote@example.com');
});

it('refreshes the closed summary without overlapping reads and keeps device navigation responsive', async () => {
  vi.useFakeTimers();
  await render();
  let finish!: (snapshot: GuiAccountsSnapshot) => void;
  vi.mocked(client.read).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(client.read).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTime(120_000));
  expect(client.read).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('28');
  await act(async () => finish({ ...accountSnapshot,
    choices: [{ ...accountSnapshot.choices[0], primaryRemainingPercent: 17 }] }));
  expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('17');
  vi.mocked(client.read).mockReturnValue(new Promise(() => {}));
  await accounts(); await click(button('切换设备'));
  expect(computers.refresh).toHaveBeenCalledOnce();
  await search('remote');
  expect(searchInput().value).toBe('remote');
  active = false; await render();
  const reads = vi.mocked(client.read).mock.calls.length;
  await act(async () => vi.advanceTimersByTime(120_000));
  expect(client.read).toHaveBeenCalledTimes(reads);
});

it.each([null, 0, 140, -10, Number.NaN])('handles missing and bounded remote quota %s', async (value) => {
  vi.mocked(client.read).mockResolvedValue({ ...accountSnapshot,
    choices: [{ ...accountSnapshot.choices[0], primaryRemainingPercent: value }] });
  await render();
  const progress = container.querySelector('[role="progressbar"]');
  if (value === null || !Number.isFinite(value)) {
    expect(progress).toBeNull(); expect(container.textContent).toContain('主用量剩余 —');
  } else expect(progress?.getAttribute('aria-valuenow')).toBe(String(Math.max(0, Math.min(100, value))));
});

it('keeps descriptions from older computers and provider balances readable', async () => {
  vi.mocked(client.read).mockResolvedValue({ ...accountSnapshot,
    choices: [{ ...accountSnapshot.choices[0], primaryRemainingPercent: undefined, plan: undefined }] });
  await render();
  expect(container.textContent).toContain('Plus · 主剩余 28% · 次剩余 63%');
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  client = { ...client, read: vi.fn().mockResolvedValue({ ...accountSnapshot,
    selection: { kind: 'provider', id: 'remote-provider' },
    choices: [{ ...accountSnapshot.choices[1], detail: '钱包余额 ¥12.34' }] }) };
  await render();
  expect(container.textContent).toContain('钱包余额 ¥12.34');
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
});

it('shows the plan and both remote quotas exactly once in the account list', async () => {
  await render(); await accounts();
  const row = accountList().querySelector('button')!;
  expect(row.querySelector('[data-plan="plus"]')?.textContent).toBe('Plus');
  expect(row.querySelector('[aria-label="主用量剩余 28%"]')).not.toBeNull();
  expect(row.querySelector('[aria-label="次用量剩余 63%"]')).not.toBeNull();
  expect(row.textContent?.match(/28%/g)).toHaveLength(1);
  expect(row.textContent?.match(/63%/g)).toHaveLength(1);
  expect(row.textContent).not.toContain('—');
});

it.each([true, false])('keeps legacy descriptions without extra quota placeholders (summary fields: %s)',
  async (hasSummaryFields) => {
    vi.mocked(client.read).mockResolvedValue({ ...accountSnapshot, choices: [{ ...accountSnapshot.choices[0],
      plan: hasSummaryFields ? 'Plus' : undefined, primaryRemainingPercent: hasSummaryFields ? 28 : undefined,
      secondaryRemainingPercent: undefined }] });
    await render(); await accounts();
    const row = accountList().querySelector('button')!;
    expect(row.textContent).toBe('Rremote@example.comPlus · 主剩余 28% · 次剩余 63%');
    expect(row.querySelector('[data-plan]')).toBeNull();
    expect(row.querySelector('[aria-label^="主用量剩余"]')).toBeNull();
    expect(row.querySelector('[aria-label^="次用量剩余"]')).toBeNull();
  });

it.each([
  { primary: 0, secondary: null, expectedPrimary: '0%', expectedSecondary: '—' },
  { primary: null, secondary: 100, expectedPrimary: '—', expectedSecondary: '100%' },
  { primary: Number.NaN, secondary: 140, expectedPrimary: '—', expectedSecondary: '100%' },
])('handles missing and zero remote list quotas: $expectedPrimary / $expectedSecondary', async (values) => {
  vi.mocked(client.read).mockResolvedValue({ ...accountSnapshot, choices: [{ ...accountSnapshot.choices[0],
    primaryRemainingPercent: values.primary, secondaryRemainingPercent: values.secondary }] });
  await render(); await accounts();
  const row = accountList().querySelector('button')!;
  expect(row.querySelector(`[aria-label="主用量剩余 ${values.expectedPrimary}"]`)).not.toBeNull();
  expect(row.querySelector(`[aria-label="次用量剩余 ${values.expectedSecondary}"]`)).not.toBeNull();
  expect(row.textContent).not.toContain('主剩余');
});

it('clears quota after disconnecting and hides it when the remote proxy stops', async () => {
  await render();
  ready = false; await render();
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  expect(container.textContent).toContain('等待连接电脑');
  vi.mocked(client.read).mockResolvedValue({ ...accountSnapshot, running: false });
  ready = true; await render();
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  expect(container.textContent).toContain('代理未启动');
});

it('opens the account list directly and switches the selected computer through its client', async () => {
  await render();
  await accounts();
  const provider = Array.from(document.querySelectorAll<HTMLButtonElement>('section button'))
    .find(entry => entry.textContent?.includes('Remote Provider'))!;
  await click(provider);
  expect(client.select).toHaveBeenCalledWith({ kind: 'provider', id: 'remote-provider' });
  expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
});

it('can return to this computer while offline without switching a local account', async () => {
  ready = false; await render();
  await click(container.querySelector('button')!); await click(button('切换设备'));
  const choices = Array.from(document.querySelectorAll<HTMLButtonElement>('section[aria-label="设备列表"] button'));
  expect(choices.find(entry => entry.textContent?.includes('Offline PC'))?.disabled).toBe(true);
  await click(choices.find(entry => entry.textContent?.includes('本机'))!);
  expect(computers.choose).toHaveBeenCalledWith(null);
  expect(client.read).not.toHaveBeenCalled(); expect(client.select).not.toHaveBeenCalled();
});

it('discards a slow account catalog when changing to another computer', async () => {
  let finish!: (snapshot: GuiAccountsSnapshot) => void;
  client.read = vi.fn(() => new Promise<GuiAccountsSnapshot>(resolve => { finish = resolve; }));
  await render();
  client = { ...client, read: vi.fn().mockResolvedValue({ ...accountSnapshot, choices: [{ ...accountSnapshot.choices[0],
    name: 'other@example.com' }] }) };
  computers = { ...computers, current: { ...computers.current!, deviceId: 'next', name: 'Next PC' } };
  await render(); await act(async () => finish(accountSnapshot));
  expect(container.textContent).toContain('other@example.com'); expect(container.textContent).not.toContain('remote@example.com');
});

it('closes only the device dropdown with Escape and keeps account browsing available during discovery', async () => {
  await render(); await accounts();
  const deviceButton = button('切换设备');
  await click(deviceButton);
  expect(computers.refresh).toHaveBeenCalledOnce();
  computers = { ...computers, loading: true };
  await render();
  expect(button('刷新设备列表').disabled).toBe(true);
  await act(async () => deviceButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(deviceButton.getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(deviceButton);
  expect(accountList().textContent).toContain('Remote Provider');
  await escape(searchInput());
  expect(document.activeElement).toBe(container.querySelector('button'));
});

it('shows both account types together, searches across them and resets search on reopen', async () => {
  await render(); await accounts();
  expect(document.querySelector('[role="tablist"]')).toBeNull();
  expect(accountList().textContent).toContain('remote@example.com');
  expect(accountList().textContent).toContain('Remote Provider');
  expect(accountList().querySelector('[role="img"][aria-label="官方账号"]')).not.toBeNull();
  expect(accountList().querySelector('[role="img"][aria-label="第三方 Provider"] svg')).not.toBeNull();
  await search('provider');
  expect(accountList().textContent).not.toContain('remote@example.com');
  expect(accountList().textContent).toContain('Remote Provider');
  await search('remote@');
  expect(accountList().textContent).toContain('remote@example.com');
  expect(accountList().textContent).not.toContain('Remote Provider');
  await search('missing');
  expect(accountList().textContent).toContain('暂无匹配项');
  await escape(searchInput()); await accounts();
  expect(searchInput().value).toBe('');
  expect(accountList().querySelectorAll('button')).toHaveLength(2);
});

it('distinguishes an account and provider that share the same id', async () => {
  client.read = vi.fn().mockResolvedValue({ ...accountSnapshot,
    choices: accountSnapshot.choices.map(choice => ({ ...choice, id: 'remote-account' })) });
  await render(); await accounts();
  const choices = accountList().querySelectorAll<HTMLButtonElement>('button');
  expect(choices).toHaveLength(2);
  expect(choices[0].getAttribute('aria-pressed')).toBe('true');
  expect(choices[1].getAttribute('aria-pressed')).toBe('false');
  await click(choices[1]);
  expect(client.select).toHaveBeenCalledWith({ kind: 'provider', id: 'remote-account' });
});
