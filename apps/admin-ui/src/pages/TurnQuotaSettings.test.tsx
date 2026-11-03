import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n-context';
import { TurnQuotaSettings } from './TurnQuotaSettings';
import type { TurnQuotaProps, TurnQuotaStatus } from './useTurnQuota';

let root: Root;
let container: HTMLDivElement;
let stored: TurnQuotaStatus;
let writes: number[];
const api: TurnQuotaProps['api'] = async <T,>(path: string, options?: RequestInit) => {
  expect(path.startsWith('/admin/api/chat-settings/turn-relay')).toBe(true);
  if (options?.method === 'PATCH') {
    const value = JSON.parse(String(options.body)) as { totalQuota: number };
    writes.push(value.totalQuota);
    stored = { ...stored, ...value, state: 'pending' };
  }
  return { ...stored } as T;
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {} }));
  stored = { totalQuota: 256, appliedQuota: 256, state: 'applied', checkedAt: '2026-11-03T00:00:00Z' };
  writes = []; container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(language: 'zh' | 'en' | 'ru' = 'zh', canManage = true) {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <I18nProvider language={language} onLanguageChange={() => {}}>
      <TurnQuotaSettings api={api} canManage={canManage} />
    </I18nProvider>
  </ConfigProvider>));
}
async function submit(value: string) {
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit',
    { bubbles: true, cancelable: true })));
}
it('loads 256 and distinguishes a saved quota from the observed running quota', async () => {
  await render();
  expect(container.querySelector('input')?.value).toBe('256');
  await submit('3');
  expect(writes).toEqual([3]);
  expect(container.textContent).toContain('已保存 · 待生效');
  expect(container.textContent).toContain('当前生效额度: 256');
});
it('rejects zero, fractional and excessive values without rounding or saving', async () => {
  await render();
  for (const value of ['0', '2.5', '65536']) await submit(value);
  expect(writes).toEqual([]);
  expect(container.textContent).toContain('请输入 1–65535 的整数');
});
it('shows synchronization failure, preserves the saved value and offers retry', async () => {
  stored = { ...stored, totalQuota: 3, appliedQuota: null, state: 'pending', issue: 'control_unavailable' };
  await render();
  expect(container.textContent).toContain('已保存的设置会保留');
  expect(container.textContent).toContain('重试应用');
  expect(container.textContent).not.toContain('已生效');
});
it('keeps read-only settings and follows the released Russian fallback', async () => {
  await render('ru', false);
  expect(container.querySelector('input')?.disabled).toBe(true);
  expect(container.querySelector('button[type=submit]')).toBeNull();
  expect(container.textContent).toContain('Remote desktop relay');
  await render('zh', false);
  expect(container.textContent).toContain('远程桌面中继');
});
