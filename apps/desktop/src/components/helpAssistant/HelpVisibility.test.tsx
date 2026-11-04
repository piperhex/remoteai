// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfigProvider, message } from 'antd';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '../../api/backend';
import { subscribeGuiEvent } from '../../../../../shared/conversation/webEvents';
import { HelpAssistantSettingsCard } from '../../pages/settings/HelpAssistantSettingsCard';
import type { Language } from '../../i18n';
import { HelpAssistant } from './HelpAssistant';
import { helpCopy } from './copy';

vi.mock('../../api/backend', () => ({ hasLocalBackend: true, invoke: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock('../../../../../shared/conversation/webEvents', () => ({ subscribeGuiEvent: vi.fn() }));

const preferenceKey = 'codex-switch:help-assistant-visible';
const unsubscribe = vi.fn();
let root: Root;
let container: HTMLDivElement;
const launcher = () => document.querySelector<HTMLButtonElement>('button[aria-controls="remote-ai-help"]');
const toggle = () => document.querySelector<HTMLButtonElement>('#help-assistant-visible')!;
const input = () => document.querySelector<HTMLTextAreaElement>('textarea')!;

async function render(language: Language = 'zh') {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <HelpAssistantSettingsCard language={language} />
    <HelpAssistant language={language} page="accounts" onOpenCodex={() => {}} />
  </ConfigProvider>));
}

async function contextMenu() {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  await act(async () => launcher()!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}

async function hide() {
  await contextMenu();
  await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click());
}

async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(invoke).mockImplementation(async (command) => command === 'remote_ai_help_status'
    ? { status: 'ready', accountRevision: 7 } : { text: 'Saved answer', sources: [] });
  vi.mocked(subscribeGuiEvent).mockResolvedValue(unsubscribe);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks(); window.localStorage.clear();
});

it.each(['zh', 'en', 'ru'] as const)('provides a localized hide menu and settings switch in %s', async (language) => {
  await render(language);
  expect(launcher()).not.toBeNull();
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  expect(container.textContent).toContain(helpCopy(language).visibilityLabel);
  await contextMenu();
  expect(document.querySelector('[role="menuitem"]')?.textContent).toBe(helpCopy(language).hide);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});

it('hides from the context menu, updates settings and restores a minimized launcher', async () => {
  await render(); await hide();
  expect(launcher()).toBeNull();
  expect(toggle().getAttribute('aria-checked')).toBe('false');
  expect(window.localStorage.getItem(preferenceKey)).toBe('false');
  await act(async () => toggle().click());
  expect(launcher()?.getAttribute('aria-expanded')).toBe('false');
  expect(window.localStorage.getItem(preferenceKey)).toBe('true');
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps the hidden preference when the app remounts', async () => {
  await render(); await hide();
  await act(async () => root.unmount());
  root = createRoot(container); await render();
  expect(launcher()).toBeNull();
  expect(toggle().getAttribute('aria-checked')).toBe('false');
  expect(invoke).not.toHaveBeenCalled();
});

it('hides an open panel from settings, stops listeners and preserves the draft', async () => {
  await render(); await act(async () => launcher()!.click()); await type('Keep this draft');
  await act(async () => toggle().click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(launcher()).toBeNull();
  expect(unsubscribe).toHaveBeenCalledOnce();
  vi.mocked(invoke).mockClear();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => toggle().click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => launcher()!.click());
  expect(input().value).toBe('Keep this draft');
});

it('keeps a pending answer and completed history while hidden', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) => command === 'remote_ai_help_status'
    ? Promise.resolve({ status: 'ready', accountRevision: 7 })
    : new Promise((resolve) => { finish = resolve; }));
  await render(); await act(async () => launcher()!.click()); await type('Help me');
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="发送"]')!.click());
  await hide();
  await act(async () => finish({ text: 'Finished while hidden', sources: [] }));
  await act(async () => toggle().click()); await act(async () => launcher()!.click());
  expect(document.querySelector('[role="log"]')?.textContent).toContain('Finished while hidden');
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'remote_ai_help_ask')).toHaveLength(1);
  await hide(); await act(async () => toggle().click()); await act(async () => launcher()!.click());
  expect(document.querySelector('[role="log"]')?.textContent).toContain('Finished while hidden');
});

it('synchronizes changes and resets from another window', async () => {
  await render();
  await act(async () => {
    window.localStorage.setItem(preferenceKey, 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: preferenceKey }));
  });
  expect(launcher()).toBeNull();
  expect(toggle().getAttribute('aria-checked')).toBe('false');
  await act(async () => {
    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
  });
  expect(launcher()).not.toBeNull();
  expect(toggle().getAttribute('aria-checked')).toBe('true');
});

it('opens the hide menu using Shift+F10 without opening the assistant', async () => {
  await render();
  await act(async () => launcher()!.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'F10', shiftKey: true, bubbles: true, cancelable: true,
  })));
  expect(document.querySelector('[role="menuitem"]')?.textContent).toBe('隐藏助手');
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps the assistant usable when the saved preference cannot be read', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
  await render();
  expect(launcher()).not.toBeNull();
  expect(toggle().getAttribute('aria-checked')).toBe('true');
});

it('reports persistence failures without hiding or changing the switch', async () => {
  const showError = vi.spyOn(message, 'error').mockImplementation(vi.fn());
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  await render(); await hide();
  expect(launcher()).not.toBeNull();
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  await act(async () => toggle().click());
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  expect(showError).toHaveBeenCalledTimes(2);
  expect(showError).toHaveBeenCalledWith(expect.objectContaining({ content: helpCopy('zh').visibilitySaveError }));
});
