// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { preparePopupDocument } from '../../../../../shared/browser/overlays/popupDocument';
import { trackPopupPlacement } from '../../../../../shared/browser/overlays/popupPlacement';
import { popupRegions } from '../../../../../shared/browser/overlays/popupRegions';

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

function setLayout(element: HTMLElement, left: number, top: number) {
  Object.defineProperties(element, {
    offsetLeft: { value: left, configurable: true }, offsetTop: { value: top, configurable: true },
    offsetWidth: { value: 100, configurable: true }, offsetHeight: { value: 50, configurable: true },
  });
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
  setLayout(menu, 10, 20);
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
  setLayout(menu, 10, 20);
  cleanup.push(trackPopupPlacement(popup, vi.fn()));
  popup.document.body.append(menu); await Promise.resolve(); frame?.(0);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(invoke.mock.calls[0][0]).toBe('browser_overlay_place');
  menu.focus(); frame?.(0);
  await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith('browser_overlay_focus'));
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(['browser_overlay_place', 'browser_overlay_focus']);
  // Native activation can blur and refocus the window without changing its active DOM element.
  menu.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  menu.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  frame?.(0);
  expect(invoke).toHaveBeenCalledTimes(2);
  menu.blur(); menu.focus(); frame?.(0);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
  expect(invoke).toHaveBeenLastCalledWith('browser_overlay_focus');
});

it('keeps the complete menu region throughout zero-scale preparation and zoom animation', () => {
  const popup = portalWindow(), menu = popup.document.createElement('div');
  menu.className = 'ant-popover'; popup.document.body.append(menu); setLayout(menu, 100, 80);
  const paintedBounds = vi.spyOn(menu, 'getBoundingClientRect');
  const expected = [{ x: 86, y: 66, width: 128, height: 78 }];
  for (const scale of [1, 0, 0.8, 0.9, 1]) {
    menu.style.transform = `scale(${scale})`;
    paintedBounds.mockReturnValue({ left: 200 - 100 * scale, top: 80, width: 100 * scale,
      height: 50 * scale, right: 200, bottom: 80 + 50 * scale } as DOMRect);
    expect(popupRegions(popup)).toEqual(expected);
  }
  menu.style.display = 'none'; expect(popupRegions(popup)).toEqual([]);
});

it('ignores offscreen preparation and includes positioned ancestors for password suggestions', () => {
  const popup = portalWindow(), host = popup.document.createElement('div');
  const menu = popup.document.createElement('div'); menu.dataset.browserPopup = '';
  popup.document.body.append(host); host.append(menu);
  setLayout(menu, -10_000, -10_000); expect(popupRegions(popup)).toEqual([]);
  setLayout(host, 200, 100); setLayout(menu, 10, 20);
  Object.defineProperty(menu, 'offsetParent', { value: host });
  expect(popupRegions(popup)).toEqual([{ x: 196, y: 106, width: 128, height: 78 }]);
});

it.each(['ant-dropdown-menu-submenu-popup', 'ant-menu-submenu-popup'])(
  'includes a separately portaled %s and releases its region when it closes', className => {
    const popup = portalWindow();
    const parent = popup.document.createElement('div'), submenu = popup.document.createElement('div');
    parent.className = 'ant-dropdown'; submenu.className = className;
    popup.document.body.append(parent, submenu);
    setLayout(parent, 100, 80); setLayout(submenu, 210, 100);
    const parentRegion = { x: 86, y: 66, width: 128, height: 78 };
    expect(popupRegions(popup)).toEqual([parentRegion, { x: 196, y: 86, width: 128, height: 78 }]);
    submenu.style.display = 'none';
    expect(popupRegions(popup)).toEqual([parentRegion]);
    submenu.style.display = ''; submenu.style.visibility = 'hidden';
    expect(popupRegions(popup)).toEqual([parentRegion]);
    submenu.remove(); parent.remove();
    expect(popupRegions(popup)).toEqual([]);
  },
);
