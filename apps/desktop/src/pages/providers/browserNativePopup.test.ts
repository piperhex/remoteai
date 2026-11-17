// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { preparePopupDocument } from '../../../../../shared/browser/overlays/popupDocument';
import { trackPopupPlacement } from '../../../../../shared/browser/overlays/popupPlacement';

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(stop => stop()); vi.restoreAllMocks(); vi.unstubAllGlobals();
  invoke.mockClear(); });

function portalWindow() {
  const iframe = document.createElement('iframe'); document.body.append(iframe);
  cleanup.push(() => iframe.remove());
  return iframe.contentWindow!;
}

it('preserves owner-realm input behavior while synchronizing theme and stylesheet changes', async () => {
  const popup = portalWindow();
  const style = document.createElement('style'); style.textContent = '.fixture {color:red}';
  document.head.append(style); cleanup.push(() => style.remove());
  cleanup.push(preparePopupDocument(popup));
  const input = popup.document.createElement('input'); popup.document.body.append(input);
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect(input.ownerDocument).toBe(popup.document);
  expect(popup.document.head.textContent).toContain('color:red');
  style.textContent = '.fixture {color:blue}';
  document.documentElement.setAttribute('data-theme', 'dark');
  cleanup.push(() => document.documentElement.removeAttribute('data-theme'));
  await vi.waitFor(() => expect(popup.document.head.textContent).toContain('color:blue'));
  expect(popup.document.documentElement.getAttribute('data-theme')).toBe('dark');
  style.remove();
  await vi.waitFor(() => expect(popup.document.head.textContent).not.toContain('.fixture'));
});

it('serializes native placement and clears its input region after the last menu closes', async () => {
  const popup = portalWindow();
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const menu = popup.document.createElement('div'); menu.setAttribute('data-browser-popup', '');
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, right: 110,
    bottom: 70, width: 100, height: 50 } as DOMRect);
  let complete: (() => void) | undefined;
  invoke.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  const failed = vi.fn(); cleanup.push(trackPopupPlacement(popup, failed));
  popup.document.body.append(menu); await Promise.resolve(); frame?.(0);
  expect(invoke).toHaveBeenCalledWith('browser_overlay_place', { placement: {
    regions: [{ x: 0, y: 6, width: 124, height: 78 }], scale: devicePixelRatio } });
  menu.remove(); await Promise.resolve(); frame?.(0);
  expect(invoke).toHaveBeenCalledTimes(1);
  complete?.(); await Promise.resolve(); frame?.(0);
  await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith('browser_overlay_place', {
    placement: { regions: [], scale: devicePixelRatio } }));
  expect(failed).not.toHaveBeenCalled();
});

it('requests native keyboard focus only after the focused popup has a visible input region', async () => {
  const popup = portalWindow();
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const menu = popup.document.createElement('button'); menu.setAttribute('data-browser-popup', '');
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, right: 110,
    bottom: 70, width: 100, height: 50 } as DOMRect);
  cleanup.push(trackPopupPlacement(popup, vi.fn()));
  popup.document.body.append(menu); await Promise.resolve(); frame?.(0);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(invoke.mock.calls[0][0]).toBe('browser_overlay_place');
  menu.focus(); frame?.(0);
  await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith('browser_overlay_focus'));
  expect(invoke.mock.calls.at(-2)?.[0]).toBe('browser_overlay_place');
});
