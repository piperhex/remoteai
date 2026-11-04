// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { uiText, setGuiLanguage } from "../../../../../shared/localization/uiText";
import { RemoteDesktopSettingsCard } from './RemoteDesktopSettingsCard';

const api = vi.hoisted(() => ({ invoke: vi.fn(), isDesktopApp: true }));
vi.mock('../../api/backend', () => api);
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('./DesktopSystemPermissions', () => ({ DesktopSystemPermissions: () => null }));

const chinese = /[一-鿿]/;
const permissions = { enabled: true, control: true, clipboardRead: false, clipboardWrite: false, files: false, audio: false };
let root: Root;
let container: HTMLDivElement;

function visibleCopy() {
  const labels = [...document.body.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label'));
  return [document.body.textContent ?? '', ...labels].join('\n');
}

function button(text: string) {
  const match = [...document.body.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
  expect(match, text).toBeDefined();
  return match as HTMLButtonElement;
}

async function renderOpen() {
  await act(async () => root.render(<RemoteDesktopSettingsCard />));
  await act(async () => button(uiText("client.desktopRemoteSettings.remoteSettings")).click());
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element));
  api.invoke.mockImplementation(async (command: string) => {
    if (command === 'remote_chat_identity') return 'AA:BB:CC';
    if (command === 'remote_desktop_permissions') return permissions;
    if (command === 'remote_desktop_service_status') return { supported: true, installed: true, running: false };
    throw new Error(`unexpected ${command}`);
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  setGuiLanguage('zh');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps the Chinese remote desktop settings copy byte-identical', async () => {
  await renderOpen();
  const copy = visibleCopy();
  for (const source of ['远程桌面', '远程设置', '允许远程访问桌面', '设备指纹', '无人值守', '已启用，尚未运行',
    '随时远程访问', '停用并卸载']) expect(copy).toContain(source);
});

it('renders the card, modal and unattended section in Russian and follows language changes', async () => {
  await renderOpen();
  await act(async () => setGuiLanguage('ru'));
  const copy = visibleCopy();
  expect(copy).not.toMatch(chinese);
  expect(copy).toContain('Настройки удалённого доступа');
  expect(copy).toContain('Разрешить удалённый доступ к рабочему столу');
  expect(copy).toContain('Включён, не запущен');
  expect(copy).toContain('Привязка к облачному аккаунту');
  expect(document.body.querySelector('[aria-label="Подробнее об отпечатке устройства"]')).not.toBeNull();
  await act(async () => setGuiLanguage('en'));
  expect(visibleCopy()).not.toMatch(chinese);
  expect(visibleCopy()).toContain('Remote settings');
  expect(visibleCopy()).toContain('Unattended access');
});

it('translates local error messages only where they are displayed', async () => {
  setGuiLanguage('ru');
  api.invoke.mockImplementation(async (command: string) => {
    if (command === 'remote_chat_identity') throw new Error('offline');
    if (command === 'remote_desktop_permissions') return permissions;
    if (command === 'remote_desktop_service_status') return { supported: true, installed: true, running: true };
    throw new Error('service failure');
  });
  await renderOpen();
  expect(document.body.textContent).toContain(
    'Не удалось прочитать отпечаток устройства. Перезапустите приложение и повторите попытку.');
  await act(async () => button('Отключить и удалить').click());
  expect(document.body.textContent).toContain('Не удалось настроить доступ без присутствия. Повторите попытку.');
  expect(visibleCopy()).not.toMatch(chinese);
  await act(async () => setGuiLanguage('zh'));
  expect(document.body.textContent).toContain('无人值守设置未能完成，请重试。');
});
