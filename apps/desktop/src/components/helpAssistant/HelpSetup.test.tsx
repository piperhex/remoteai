// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../api/backend';
import { subscribeGuiEvent } from '../../../../../shared/conversation/webEvents';
import { HelpAssistant } from './HelpAssistant';
import type { DashboardPage } from '../dashboard/DashboardNavigation';
import type { HelpStatus } from './types';

const backend = vi.hoisted(() => ({ available: true }));
vi.mock('../../api/backend', () => ({ get hasLocalBackend() { return backend.available; }, invoke: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('../../../../../shared/conversation/webEvents', () => ({ subscribeGuiEvent: vi.fn() }));

let root: Root | undefined;
let container: HTMLDivElement;
let status: HelpStatus;
let version: string | null;
const openCodex = vi.fn();
const stopProgress = vi.fn();
const events = new Map<string, (event: unknown) => void>();
const release = { version: '0.99.0', size: 100 };
const calls = (command: string) => vi.mocked(invoke).mock.calls.filter(([name]) => name === command);
const button = (label: string) => [...document.querySelectorAll('button')]
  .find((item) => (item.getAttribute('aria-label') ?? item.textContent) === label)!;
const input = () => document.querySelector<HTMLTextAreaElement>('textarea')!;

async function respond(command: string) {
  if (command === 'remote_ai_help_status') return { status, accountRevision: 7 };
  if (command === 'codex_gui_cli_status') return { version, release: null };
  if (command === 'codex_gui_cli_release') return release;
  if (command === 'codex_gui_cli_install') { version = release.version; status = 'initializeRequired'; return { version }; }
  if (command === 'codex_gui_connect') { status = 'accountRequired'; return []; }
  throw new Error(`Unexpected command: ${command}`);
}
async function render(page: DashboardPage = 'accounts') {
  await act(async () => root!.render(<HelpAssistant language="zh" page={page} onOpenCodex={openCodex} />));
}
async function click(label: string) { await act(async () => button(label).click()); }
async function open() { await render(); await click('问题解答助手'); }

beforeEach(() => {
  vi.clearAllMocks(); events.clear(); backend.available = true;
  status = 'installRequired'; version = null;
  vi.mocked(invoke).mockImplementation(respond);
  vi.mocked(subscribeGuiEvent).mockImplementation(async (name, callback) => {
    events.set(name, callback);
    return name === 'codex-gui-download' ? stopProgress : () => {};
  });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root?.unmount()); container.remove(); });

it('installs only after a click, follows progress and stays on the current page', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'codex_gui_cli_install') await pending;
    return respond(command);
  });
  await open();
  expect(calls('codex_gui_cli_status')).toHaveLength(0);
  expect(calls('codex_gui_cli_release')).toHaveLength(0);
  await act(async () => { button('立即安装').click(); button('立即安装').click(); });
  expect(calls('codex_gui_cli_install')).toEqual([['codex_gui_cli_install', { version: release.version }]]);
  expect(input().disabled).toBe(true);
  expect(button('立即安装').disabled).toBe(true);
  await act(async () => events.get('codex-gui-download')?.({ downloaded: 42, total: 100, phase: 'downloading' }));
  expect(document.body.textContent).toContain('42%');
  await click('收起助手'); await render('settings'); await click('问题解答助手');
  expect(document.body.textContent).toContain('正在下载 Codex');
  await act(async () => { finish(); await pending; });
  expect(calls('codex_gui_connect')).toEqual([['codex_gui_connect', { reuseExisting: true }]]);
  expect(stopProgress).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain('请先在 Codex 中选择一个可用账户');
  expect(openCodex).not.toHaveBeenCalled();
  expect(calls('remote_ai_help_ask')).toHaveLength(0);
});

it('initializes an existing installation in place without downloading', async () => {
  status = 'initializeRequired'; version = release.version;
  await open(); await click('启用助手');
  expect(calls('codex_gui_connect')).toEqual([['codex_gui_connect', { reuseExisting: true }]]);
  expect(calls('codex_gui_cli_install')).toHaveLength(0);
  expect(calls('codex_gui_cli_release')).toHaveLength(0);
  expect(openCodex).not.toHaveBeenCalled();
});

it('refreshes after installation even if an older availability check is still pending', async () => {
  let finishInstall!: () => void;
  let finishStatus!: (value: { status: HelpStatus }) => void;
  const pendingInstall = new Promise<void>((resolve) => { finishInstall = resolve; });
  const pendingStatus = new Promise<{ status: HelpStatus }>((resolve) => { finishStatus = resolve; });
  let delayStatus = false;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'codex_gui_cli_install') await pendingInstall;
    if (command === 'remote_ai_help_status' && delayStatus) { delayStatus = false; return pendingStatus; }
    return respond(command);
  });
  await open(); await click('立即安装');
  delayStatus = true;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await act(async () => finishInstall());
  await act(async () => finishStatus({ status: 'initializeRequired' }));
  expect(button('选择账户')).toBeDefined();
  expect(calls('remote_ai_help_status')).toHaveLength(3);
  expect(calls('codex_gui_cli_install')).toHaveLength(1);
});

it('skips reinstalling if another view already installed Codex', async () => {
  await open(); version = release.version;
  await click('立即安装');
  expect(calls('codex_gui_cli_install')).toHaveLength(0);
  expect(calls('codex_gui_cli_release')).toHaveLength(0);
  expect(calls('codex_gui_connect')).toHaveLength(1);
});

it('allows questions when initialization finds an already selected account', async () => {
  status = 'initializeRequired';
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'codex_gui_connect') { status = 'ready'; return []; }
    return respond(command);
  });
  await open(); await click('启用助手');
  expect(input().disabled).toBe(false);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(openCodex).not.toHaveBeenCalled();
});

it('reports a safe installation error and permits retry', async () => {
  await open();
  vi.mocked(invoke).mockRejectedValueOnce(new Error('secret-token C:/private/config'));
  await click('立即安装');
  expect(document.body.textContent).toContain('安装未完成，请检查网络后重试');
  expect(document.body.textContent).not.toContain('secret-token');
  expect(calls('codex_gui_connect')).toHaveLength(0);
  expect(stopProgress).toHaveBeenCalledOnce();
  expect(button('立即安装').disabled).toBe(false);
  await click('立即安装');
  expect(calls('codex_gui_cli_install')).toHaveLength(1);
  expect(document.body.textContent).not.toContain('安装未完成');
});

it('retries only initialization after a successful install and connection failure', async () => {
  let fail = true;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'codex_gui_connect' && fail) throw new Error('private startup path');
    return respond(command);
  });
  await open(); await click('立即安装');
  expect(document.body.textContent).toContain('暂时无法启用助手，请重试');
  expect(document.body.textContent).not.toContain('private startup path');
  fail = false; await click('启用助手');
  expect(calls('codex_gui_cli_install')).toHaveLength(1);
  expect(calls('codex_gui_connect')).toHaveLength(2);
});

it('explains the browser preview limitation without pretending installation succeeded', async () => {
  backend.available = false;
  await open(); await click('立即安装');
  expect(document.body.textContent).toContain('当前仅为界面预览，无法安装');
  expect(invoke).not.toHaveBeenCalled();
  expect(openCodex).not.toHaveBeenCalled();
});

it('cleans a late progress subscription after unmount without installing', async () => {
  let finish!: (stop: () => void) => void;
  const pending = new Promise<() => void>((resolve) => { finish = resolve; });
  await open();
  vi.mocked(subscribeGuiEvent).mockReturnValueOnce(pending);
  await click('立即安装');
  await act(async () => root!.unmount()); root = undefined;
  await act(async () => finish(stopProgress));
  expect(stopProgress).toHaveBeenCalledOnce();
  expect(calls('codex_gui_cli_install')).toHaveLength(0);
  expect(calls('codex_gui_connect')).toHaveLength(0);
});
