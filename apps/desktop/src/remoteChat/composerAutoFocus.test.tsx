// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useComposerAutoFocus } from '../../../../shared/chat/useComposerAutoFocus';

const native = vi.hoisted(() => ({ listen: vi.fn(), stop: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onFocusChanged: native.listen }) }));
let host: HTMLDivElement;
let root: Root;
let desktop = true;
function Probe({ active = true, disabled = false }: { active?: boolean; disabled?: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useComposerAutoFocus({ input, active, disabled });
  return <><textarea ref={input} disabled={disabled} /><button>Other control</button></>;
}
const input = () => host.querySelector('textarea')!;
const button = () => host.querySelector('button')!;
const render = async (props: { active?: boolean; disabled?: boolean } = {}) => {
  await act(async () => { root.render(<Probe {...props} />); });
  await frame();
};
const frame = () => act(async () => { await vi.advanceTimersByTimeAsync(32); });
const resume = async () => {
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await frame();
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); desktop = true;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: desktop,
    addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  native.listen.mockResolvedValue(native.stop);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it('focuses on entry and re-entry, but not routine renders or disabled state changes', async () => {
  await render(); expect(document.activeElement).toBe(input());
  button().focus(); await render(); expect(document.activeElement).toBe(button());
  await render({ disabled: true }); await render(); expect(document.activeElement).toBe(button());
  await render({ active: false }); await resume(); expect(document.activeElement).toBe(button());
  await render(); expect(document.activeElement).toBe(input());
});

it('defers entry until ready, and cancels the pending request if the user works elsewhere', async () => {
  await render({ disabled: true }); expect(document.activeElement).not.toBe(input());
  await render(); expect(document.activeElement).toBe(input());
  await render({ active: false }); await render({ disabled: true });
  button().focus(); button().dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await render(); expect(document.activeElement).toBe(button());
});

it('restores on activation without stealing focus from a dialog or hidden page', async () => {
  await render(); button().focus(); await resume(); expect(document.activeElement).toBe(input());
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); host.append(dialog);
  button().focus(); await resume(); expect(document.activeElement).toBe(button()); dialog.remove();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await resume(); expect(document.activeElement).toBe(button());
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange')); await frame();
  expect(document.activeElement).toBe(input());
});

it('does not open the keyboard on mobile Web but supports narrow native windows', async () => {
  desktop = false; await render(); expect(document.activeElement).not.toBe(input());
  await resume(); expect(document.activeElement).not.toBe(input());
  vi.stubGlobal('__TAURI_INTERNALS__', {}); await render();
  expect(document.activeElement).toBe(input());
  button().focus();
  native.listen.mock.calls[0][0]({ payload: true }); await frame();
  expect(document.activeElement).toBe(input());
  await render({ active: false }); expect(native.stop).toHaveBeenCalledOnce();
});

it('ignores a picker finishing its close animation when returning to the conversation', async () => {
  await render({ active: false });
  const picker = document.createElement('div');
  picker.className = 'ant-dropdown ant-slide-up-leave ant-slide-up-leave-active'; host.append(picker);
  button().focus(); await render(); expect(document.activeElement).toBe(input());
});

it('releases a native listener that resolves after the workspace becomes inactive', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  let resolve: (stop: () => void) => void = () => {};
  native.listen.mockReturnValue(new Promise<() => void>(done => { resolve = done; }));
  await render(); await render({ active: false });
  await act(async () => { resolve(native.stop); });
  expect(native.stop).toHaveBeenCalledOnce();
});
