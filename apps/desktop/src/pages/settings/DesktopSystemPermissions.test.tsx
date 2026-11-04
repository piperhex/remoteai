import { resources as clientResources } from '@remoteai/i18n/client';
const english: Readonly<Record<string, string>> = clientResources.en;
const russianCopy: Readonly<Record<string, string>> = clientResources.ru;
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';


import { setGuiLanguage } from "../../../../../shared/localization/uiText";
import { DesktopSystemPermissions } from './DesktopSystemPermissions';

const api = vi.hoisted(() => ({ invoke: vi.fn(), restartApplication: vi.fn() }));
vi.mock('../../api/backend', () => api);
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let root: Root;
let container: HTMLDivElement;
const han = /[一-鿿]/;
const russian: Readonly<Record<string, string>> = russianCopy;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  api.invoke.mockResolvedValue({ screenRecording: true, accessibility: false, restartRequired: [] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setGuiLanguage('zh');
  vi.unstubAllGlobals();
});

const labels = () => [...container.querySelectorAll('button')].map(button => button.getAttribute('aria-label'));

it('keeps the Chinese copy and switches the whole block to Russian without remounting', async () => {
  await act(async () => root.render(<DesktopSystemPermissions active />));
  expect(container.textContent).toContain('Mac 访问权限');
  expect(container.textContent).toContain('让其他设备看到这台 Mac 的画面。');
  expect(labels()).toEqual(['修复屏幕录制权限', '开启辅助功能', '修复辅助功能权限']);

  await act(async () => setGuiLanguage('ru'));
  expect(container.textContent).toContain('Разрешения на Mac');
  expect(container.textContent).toContain('Универсальный доступ');
  expect(container.textContent).toContain('Включено');
  expect(labels()).toEqual(['Восстановить разрешение на запись экрана', 'Разрешить универсальный доступ',
    'Восстановить разрешение универсального доступа']);
  expect(container.textContent).not.toMatch(han);
});

it('shows host errors in the interface language', async () => {
  setGuiLanguage('ru');
  await act(async () => root.render(<DesktopSystemPermissions active />));
  api.invoke.mockRejectedValueOnce(new Error('denied'));
  const allow = container.querySelector<HTMLButtonElement>('button[aria-label="Разрешить универсальный доступ"]')!;
  await act(async () => allow.click());
  expect(container.querySelector('.ant-alert-error')?.textContent)
    .toBe('Не удалось открыть настройки разрешений. Разрешите доступ в Системных настройках, в разделе «Конфиденциальность и безопасность».');
});

it('has English and Russian copy for every semantic key in the block and its hook', () => {
  const sources = ['./DesktopSystemPermissions.tsx', './useDesktopSystemPermissions.ts']
    .flatMap(file => [...readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/["'](client\.[^"'\n]+)["']/g)])
    .map(match => match[1]);
  expect(sources.length).toBeGreaterThan(20);
  for (const source of sources) {
    expect(english[source], source).toBeTruthy();
    expect(russian[source], source).toBeTruthy();
    expect(english[source], source).not.toMatch(han);
    expect(russian[source], source).not.toMatch(han);
  }
});
