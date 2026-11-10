// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../../api/backend';
import type { GuiSettingsAccounts, GuiSettingsClient } from '../../../../../../shared/remote-chat/guiSettings';
import { RemoteGuiSettingsDialog } from './RemoteGuiSettingsDialog';

vi.mock('../../../api/backend', () => ({ invoke: vi.fn() }));
vi.mock('../../../../../../shared/platform/localBackend', async () => await import('../../../api/backend'));
vi.mock('../../../hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));

const catalog: GuiSettingsAccounts = { accounts: [{ id: 'remote-account', email: 'remote@example.com',
  expiresAt: '', localProxyCompatible: true, usage: {} }], providers: [] };
const settings = { enabled: true, switchOnQuotaExhaustion: true, minimumRemainingPercent: 5,
  mode: 'sequential' as const, fallbackProviderId: null,
  accounts: [{ accountId: 'remote-account', enabled: true, priority: 10, thresholdPercent: 5 }] };
let root: Root;
let container: HTMLDivElement;
let client: GuiSettingsClient;
const tab = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
  .find(element => element.textContent === name)!;
const footerButton = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.ant-modal-footer button')]
  .find(element => element.textContent?.replace(/\s/g, '') === name)!;
const render = () => act(async () => root.render(<RemoteGuiSettingsDialog client={client}
  privacyMode={false} onClose={() => {}} />));
const click = (element: HTMLElement) => act(async () => element.click());

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  const original = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => original(element));
  vi.mocked(invoke).mockReset();
  client = { accounts: vi.fn().mockResolvedValue(catalog),
    autoSwitch: { read: vi.fn().mockResolvedValue(settings), write: vi.fn().mockResolvedValue(settings) },
    context: { read: vi.fn(), write: vi.fn() }, systemPrompts: { read: vi.fn(), write: vi.fn() } };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
});

it('keeps one dialog while loading remote accounts and prevents saving an incomplete account catalog', async () => {
  let finish!: (value: GuiSettingsAccounts) => void;
  vi.mocked(client.accounts).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render();
  const dialog = document.querySelector('[role="dialog"]');
  expect(footerButton('保存').disabled).toBe(true);
  await click(tab('界面'));
  expect(document.querySelector('[aria-label="字体预览"]')).not.toBeNull();
  await act(async () => finish(catalog));
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  await click(tab('自动切号'));
  expect(document.body.textContent).toContain('remote@example.com');
  expect(footerButton('保存').disabled).toBe(false);
  await click(footerButton('保存'));
  expect(client.autoSwitch.write).toHaveBeenCalledExactlyOnceWith(settings);
  expect(invoke).not.toHaveBeenCalled();
});

it('retains client preferences after a remote account failure and retries without exposing host errors', async () => {
  vi.mocked(client.accounts).mockRejectedValueOnce(new Error('private-host-path')).mockResolvedValueOnce(catalog);
  await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('暂时无法读取设置，请重试。');
  expect(document.body.textContent).not.toContain('private-host-path');
  expect(footerButton('保存').disabled).toBe(true);
  await click(tab('消息发送'));
  expect(document.querySelector('[role="switch"]')).not.toBeNull();
  await click(tab('自动切号'));
  const retry = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(element => element.textContent?.replace(/\s/g, '') === '重试')!;
  await click(retry);
  expect(client.accounts).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('remote@example.com');
  expect(footerButton('保存').disabled).toBe(false);
  expect(client.autoSwitch.write).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});
