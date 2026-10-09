// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopErrorBoundary } from '../../../web/src/chat/desktop/DesktopErrorBoundary';

let root: Root;
let container: HTMLDivElement;
let broken: boolean;
const close = vi.fn();
const fixtureError = new Error('Fixture viewer failure');
const ignoreExpectedError = (event: ErrorEvent) => { if (event.error === fixtureError) event.preventDefault(); };
function Viewer() {
  if (broken) throw fixtureError;
  return <span>Live desktop</span>;
}
function Harness({ active = true }) {
  return <><p>Chat remains available</p><DesktopErrorBoundary active={active} close={close}>
    <Viewer />
  </DesktopErrorBoundary></>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.addEventListener('error', ignoreExpectedError);
  close.mockClear(); broken = false;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); window.removeEventListener('error', ignoreExpectedError);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('contains a viewer crash and remounts only the viewer on retry', () => {
  act(() => root.render(<Harness />));
  broken = true; act(() => root.render(<Harness />));
  expect(container.textContent).toContain('Chat remains available');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('请重新连接，或关闭后再试。');
  broken = false;
  act(() => document.querySelector<HTMLButtonElement>('.rd-fallback-actions button')!.click());
  expect(container.textContent).toContain('Live desktop');
  expect(document.querySelector('.rd-fallback')).toBeNull();
});

it('keeps closing available and removes the fallback when the workspace becomes inactive', () => {
  broken = true; act(() => root.render(<Harness />));
  act(() => document.querySelector<HTMLButtonElement>('.rd-fallback-actions button:last-child')!.click());
  expect(close).toHaveBeenCalledOnce();
  broken = false; act(() => root.render(<Harness active={false} />));
  expect(document.querySelector('.rd-fallback')).toBeNull();
});
