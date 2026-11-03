import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n-context';
import { ChatSettingsPage } from './ChatSettingsPage';
import { DEFAULT_CHAT_POLICY, type ChatPolicy } from '../../../../shared/chat/chatPolicy';

// Relay settings have their own API/form coverage in TurnQuotaSettings.test.tsx.
vi.mock('./TurnQuotaSettings', () => ({ TurnQuotaSettings: () => null }));

let root: Root;
let container: HTMLDivElement;
let saved: ChatPolicy | undefined;
const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  expect(path).toBe('/admin/api/chat-settings');
  if (options?.method === 'PATCH') saved = JSON.parse(String(options.body)) as ChatPolicy;
  return (saved ?? DEFAULT_CHAT_POLICY) as T;
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  saved = undefined; container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});
async function render(canManage = true) {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <I18nProvider language="zh" onLanguageChange={() => {}}><App>
      <ChatSettingsPage api={api} canManage={canManage} />
    </App></I18nProvider>
  </ConfigProvider>));
}
function input(name: string) {
  const element = container.querySelector<HTMLInputElement>(`input[id="${name}"]`);
  expect(element).not.toBeNull(); return element!;
}
async function fill(name: string, value: string) {
  const element = input(name);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
it('loads the default file limit and saves three independent attachment limits', async () => {
  await render();
  expect(input('loungeFileMaxMb').value).toBe('300');
  expect(input('loungeGroupImageMaxMb').value).toBe('1');
  expect(input('loungeDirectImageMaxMb').value).toBe('1');
  await fill('loungeFileMaxMb', '500');
  await fill('loungeGroupImageMaxMb', '2');
  await fill('loungeDirectImageMaxMb', '5');
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit',
    { bubbles: true, cancelable: true })));
  expect(saved).toMatchObject({ loungeFileMaxMb: 500, loungeGroupImageMaxMb: 2, loungeDirectImageMaxMb: 5 });
});
it('keeps attachment settings read-only without management permission', async () => {
  await render(false);
  for (const name of ['loungeFileMaxMb', 'loungeGroupImageMaxMb', 'loungeDirectImageMaxMb']) {
    expect(input(name).disabled).toBe(true);
  }
  expect(container.querySelector('button[type=submit]')).toBeNull();
});
