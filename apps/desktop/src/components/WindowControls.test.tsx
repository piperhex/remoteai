// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WindowControls } from './WindowControls';

const native = vi.hoisted(() => ({
  maximized: false,
  resized: undefined as (() => void) | undefined,
  unlisten: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  isMaximized: async () => native.maximized,
  onResized: async (handler: () => void) => { native.resized = handler; return native.unlisten; },
  toggleMaximize: native.toggleMaximize,
  minimize: vi.fn(),
  close: vi.fn(),
}) }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  native.maximized = false;
  native.resized = undefined;
  native.unlisten.mockClear();
  native.toggleMaximize.mockReset().mockImplementation(async () => { native.maximized = !native.maximized; });
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('shows the restore icon after maximizing and tracks external window resizing', async () => {
  await act(async () => root.render(<WindowControls onError={error => { throw Error(error); }} t={key => key} />));
  const button = host.querySelector<HTMLButtonElement>('[aria-label="windowMenu.maximize"]')!;
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.querySelector('.lucide-square')).not.toBeNull();

  await act(async () => button.click());
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.querySelector('.lucide-copy')).not.toBeNull();

  await act(async () => { native.maximized = false; native.resized?.(); });
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.querySelector('.lucide-square')).not.toBeNull();
  expect(native.unlisten).not.toHaveBeenCalled();
});
