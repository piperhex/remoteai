import { formatRemoteError } from '../../../../../shared/localization/errors';

// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translateMessage } from "../../../../../shared/localization/messages";
import { setGuiLanguage } from "../../../../../shared/localization/uiText";
import { quickMenuLanguage } from './language';
import { MenuPanel } from './MenuPanel';
import type { MenuEntry, MenuSnapshot } from './types';
import quickMenuSource from './useQuickMenu.ts?raw';

const chinese = /[一-鿿]/;
const entry = (id: string, text: string, extra: Partial<MenuEntry> = {}): MenuEntry => ({
  id, text, enabled: true, checked: false, separator: false, children: [], ...extra,
});
const snapshot = (header: string): MenuSnapshot => ({
  revision: 1,
  entries: [
    entry('tray:accounts-header', header, { enabled: false }),
    entry('tray:provider-submenu:models', 'Models', { children: [entry('tray:provider-model:one', 'model-one')] }),
  ],
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setGuiLanguage('zh');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setGuiLanguage('zh');
  vi.unstubAllGlobals();
});

async function render(menu: MenuSnapshot | null, error = '') {
  await act(async () => root.render(
    <MenuPanel snapshot={menu} panel={createRef<HTMLDivElement>()} error={error} activate={vi.fn()} dismiss={vi.fn()} />,
  ));
}

it('follows the tray header language and falls back to the GUI language', () => {
  expect(quickMenuLanguage(snapshot('账号'))).toBe('zh');
  expect(quickMenuLanguage(snapshot('Accounts'))).toBe('en');
  expect(quickMenuLanguage(snapshot('Аккаунты'))).toBe('ru');
  setGuiLanguage('ru');
  expect(quickMenuLanguage(null)).toBe('ru');
  expect(quickMenuLanguage(snapshot('constructor'))).toBe('ru');
});

it('renders menu chrome and errors in the tray language', async () => {
  const cases = [
    ['账号', '快捷菜单', '关闭菜单', '选择模型', '返回', '操作未完成，请重新打开菜单再试。'],
    ['Accounts', 'Quick menu', 'Close menu', 'Choose model', 'Back',
      'The action did not complete. Reopen the menu and try again.'],
    ['Аккаунты', 'Быстрое меню', 'Закрыть меню', 'Выбрать модель', translateMessage('ru', "client.mobile.back"),
      translateMessage('ru', "client.desktopQuickMenu.theActionDidNotCompleteReopenTheMenuAndTry")],
  ] as const;
  for (const [header, menuLabel, closeLabel, modelSection, backLabel, error] of cases) {
    await render(snapshot(header), '操作未完成，请重新打开菜单再试。');
    expect(container.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(menuLabel);
    expect(container.querySelector('.quick-menu-close')?.getAttribute('aria-label')).toBe(closeLabel);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(error);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-menu-id="tray:provider-submenu:models"]')?.click());
    expect(container.querySelector('.quick-menu-back')?.getAttribute('aria-label')).toBe(backLabel);
    expect(container.querySelector('.quick-menu-section')?.textContent).toBe(modelSection);
    await act(async () => root.unmount());
    root = createRoot(container);
  }
});

it('shows the loading state and load errors before the first snapshot in the GUI language', async () => {
  setGuiLanguage('ru');
  await render(null, '菜单暂时无法加载，请重新打开。');
  expect(container.querySelector('.quick-menu-notice')?.textContent).toBe('Загрузка…');
  expect(container.querySelector('[role="alert"]')?.textContent)
    .toBe(translateMessage('ru', "client.desktopQuickMenu.couldNotLoadTheMenuReopenIt"));
});

it('has English and Russian copy for every quick menu error', () => {
  const errors = [...quickMenuSource.matchAll(/setError\("([^"]+)"\)/g)].map((match) => match[1]);
  expect(new Set(errors).size).toBe(3);
  for (const error of errors) {
    for (const language of ['en', 'ru'] as const) {
      const text = formatRemoteError(language, error);
      expect(text, `${language}: ${error}`).not.toBe(error);
      expect(text, `${language}: ${error}`).not.toMatch(chinese);
    }
  }
});
