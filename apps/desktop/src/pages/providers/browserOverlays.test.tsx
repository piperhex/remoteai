// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderBrowserSurface } from '../../../../../shared/browser/managed/ProviderBrowserSurface';
import { WebsiteBrowserSurface } from '../../../../../shared/file-preview/workspace/ManagedBrowserSurface';
import { BrowserClientContext } from '../../../../../shared/file-preview/workspace/browserClient';
import { marketText } from '../../../../../shared/provider-market/i18n';
import { createBrowserTab } from '../../../../../shared/provider-market/browserState';

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
let container: HTMLDivElement;
let root: Root;
const rect = { x: 600, y: 100, width: 600, height: 600 } as DOMRect;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    const hidden = this.hidden || this.style.display === 'none'
      || (this instanceof HTMLDialogElement && !this.open);
    return (hidden ? [] : [rect]) as unknown as DOMRectList;
  });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); document.querySelectorAll('dialog').forEach(dialog => dialog.remove());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function mountBrowser(managed: boolean, embedded = true) {
  const tab = { ...createBrowserTab(), id: 'overlay-tab', url: 'https://example.test',
    ...(managed ? { automationThread: 'thread' } : {}) };
  const Surface = managed ? WebsiteBrowserSurface : ProviderBrowserSurface;
  await act(async () => root.render(<BrowserClientContext.Provider value={{ native: true,
    request: vi.fn().mockResolvedValue({ tabs: [] }), subscribe: vi.fn(async () => () => {}) }}>
    <section aria-modal={embedded ? undefined : 'true'}>
      <Surface tab={tab} active command={null} hideForModal={embedded} onNavigate={() => {}}
        onPopup={() => {}} t={marketText('zh')} />
    </section>
  </BrowserClientContext.Provider>));
}

async function expectVisible(visible: boolean, managed: boolean) {
  const command = managed ? 'codex_gui_browser_place' : 'provider_browser_sync';
  await act(async () => {
    await vi.waitFor(() => {
      const calls = invoke.mock.calls.filter(([name]) => name === command);
      expect(calls.at(-1)?.[1].request.visible).toBe(visible);
    });
  });
}

for (const managed of [false, true]) {
  const browser = managed ? 'managed' : 'provider';
  it(`${browser} browser hides for native dialogs and restores after the last closes`, async () => {
    await mountBrowser(managed);
    await expectVisible(true, managed);
    const dialog = document.createElement('dialog'); document.body.append(dialog);
    await act(async () => { dialog.open = true; });
    await expectVisible(false, managed);
    const nested = document.createElement('dialog'); nested.open = true;
    await act(async () => { document.body.append(nested); dialog.open = false; });
    await expectVisible(false, managed);
    await act(async () => { nested.remove(); });
    await expectVisible(true, managed);
    // Reuse the same mounted dialog: observing child insertions alone misses this transition.
    await act(async () => { dialog.open = true; });
    await expectVisible(false, managed);
    await act(async () => { dialog.hidden = true; });
    await expectVisible(true, managed);
    expect(invoke.mock.calls.some(([name]) => name === 'provider_browser_close')).toBe(false);
    if (!managed) expect(invoke.mock.calls.at(-1)?.[1].request.navigate).toBe(false);
  });
}

it('keeps the Provider dialog visible but hides its native page under an image preview', async () => {
  await mountBrowser(false, false);
  await expectVisible(true, false);
  const dialog = document.createElement('dialog'); dialog.open = true;
  await act(async () => { document.body.append(dialog); });
  await expectVisible(false, false);
  await act(async () => { dialog.remove(); });
  await expectVisible(true, false);
});
