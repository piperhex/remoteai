// @vitest-environment jsdom
import { act } from 'react';
import { ConfigProvider } from 'antd';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudLoginModal } from './CloudLoginModal';
import { translate, type Language } from '../../i18n';

vi.mock('../../api/backend', () => ({
  isHostedWebApp: false, loadSavedCloudLogin: () => Promise.resolve(null),
}));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
const onLogin = vi.fn<() => Promise<boolean>>();
const onRegister = vi.fn<() => Promise<boolean>>();
const onClose = vi.fn();
let root: Root;
let container: HTMLDivElement;

const button = (text: string) => [...document.querySelectorAll('button')]
  .find(node => node.textContent?.replace(/\s+/g, '') === text.replace(/\s+/g, ''))!;
const checkbox = () => document.querySelector<HTMLInputElement>('input[aria-label="我已阅读并同意用户协议"]')!;
const click = async (node: HTMLElement) => act(async () => node.click());

async function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function render(language: Language = 'zh') {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <CloudLoginModal loading={false} sendingRegistrationCode={false} onClose={onClose}
      onLogin={onLogin} onRegister={onRegister} onForgotPassword={vi.fn()}
      onSendRegistrationCode={vi.fn()} sessionExpired={false} language={language}
      t={(key, values) => translate(language, key, values)} />
  </ConfigProvider>));
  await fill('#cloud-login-email', 'review@example.test');
  await fill('#cloud-login-password', 'local-review');
}

beforeEach(() => {
  vi.clearAllMocks();
  onLogin.mockResolvedValue(false);
  onRegister.mockResolvedValue(false);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => getComputedStyle(element));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('requires explicit consent for form submission and keeps cancellation unchecked', async () => {
  await render();
  expect(checkbox().checked).toBe(false);
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true })));
  expect(document.body.textContent).toContain('继续登录即表示');
  expect(onLogin).not.toHaveBeenCalled();
  await click(button('暂不同意'));
  expect(checkbox().checked).toBe(false);
  await click(button('登录'));
  await click(button('同意并登录'));
  expect(onLogin).toHaveBeenCalledExactlyOnceWith('review@example.test', 'local-review', false);
  expect(checkbox().checked).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
});

it('reading never grants consent and returning from reading preserves the pending prompt', async () => {
  await render();
  await click(button('《用户协议》'));
  expect(document.body.textContent).toContain('九、联系与争议处理');
  await click(button('关闭协议'));
  expect(checkbox().checked).toBe(false);
  await click(button('登录'));
  await click(document.querySelector<HTMLButtonElement>('.agreement-confirm .agreement-link')!);
  await click(button('关闭协议'));
  expect(button('同意并登录')).toBeDefined();
  expect(onLogin).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it('checked consent logs in directly and repeated submissions stay single-flight', async () => {
  let finish!: (ok: boolean) => void;
  onLogin.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await click(checkbox());
  await act(async () => {
    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true }));
  });
  expect(onLogin).toHaveBeenCalledOnce();
  expect(button('同意并登录')).toBeUndefined();
  await act(async () => finish(true));
  expect(onClose).toHaveBeenCalledOnce();
});

it('requires consent for registration and resumes registration instead of login', async () => {
  await render();
  await click(button('注册'));
  await fill('#cloud-registration-code', '123456');
  await click(button('注册'));
  expect(onRegister).not.toHaveBeenCalled();
  await click(button('同意并注册'));
  expect(onRegister).toHaveBeenCalledExactlyOnceWith('review@example.test', 'local-review', '123456', false);
  expect(onLogin).not.toHaveBeenCalled();
});

it('uses English for the reader and prompt', async () => {
  await render('en');
  await click(button('User Agreement'));
  expect(document.body.textContent).toContain('9. Contact and disputes');
  await click(button('Close agreement'));
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true })));
  expect(button('Agree and sign in')).toBeDefined();
  expect(onLogin).not.toHaveBeenCalled();
});
