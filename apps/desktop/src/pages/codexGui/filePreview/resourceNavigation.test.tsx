// @vitest-environment jsdom
import { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserSurfaceProps } from '../../../../../../shared/provider-market/ProviderBrowser';
import type { BrowserResource } from '../../../../../../shared/file-preview/workspace/browserResources';
import { navigableBrowserResource, ResourceFileNavigationContext }
  from '../../../../../../shared/file-preview/workspace/resourceNavigation';

let root: Root;
let host: HTMLDivElement;
const navigate = vi.fn();
const closeDocument = vi.fn();
const closeImage = vi.fn();
const image: BrowserResource = { key: 'image', url: 'file:///image.png', title: 'image.png',
  render: () => null, release: closeImage };
const props: BrowserSurfaceProps = { tab: { id: 'tab', url: 'file:///page.html', title: 'page.html',
  headerOrigin: '', headers: {}, history: ['file:///page.html'], historyIndex: 0 },
  active: true, command: null, onNavigate: navigate, onPopup: vi.fn(), t: key => key };

function Document() {
  const open = useContext(ResourceFileNavigationContext);
  return <button onClick={() => open?.('/image.png')}>Open</button>;
}
function fixture(read: (path: string) => Promise<BrowserResource>) {
  return navigableBrowserResource({ key: 'document', title: 'page.html', url: 'file:///page.html',
    render: () => <Document />, release: closeDocument }, read);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks(); vi.unstubAllGlobals();
});

it('shares concurrent image reads and releases the document and each retained image exactly once', async () => {
  let finish!: (page: BrowserResource) => void;
  const read = vi.fn(() => new Promise<BrowserResource>(resolve => { finish = resolve; }));
  const resource = fixture(read);
  await act(async () => root.render(resource.render(props)));
  await act(async () => { host.querySelector('button')!.click(); host.querySelector('button')!.click(); });
  expect(read).toHaveBeenCalledOnce();
  await act(async () => finish(image));
  expect(navigate).toHaveBeenCalledExactlyOnceWith(image.url);
  await act(async () => host.querySelector('button')!.click());
  expect(read).toHaveBeenCalledOnce();
  resource.release?.(); resource.release?.();
  expect(closeDocument).toHaveBeenCalledOnce();
  expect(closeImage).toHaveBeenCalledOnce();
});

it('releases a late image after tab closure without navigating or restoring the tab', async () => {
  let finish!: (page: BrowserResource) => void;
  const resource = fixture(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(resource.render(props)));
  await act(async () => host.querySelector('button')!.click());
  await act(async () => { resource.release?.(); root.render(null); });
  await act(async () => finish(image));
  expect(navigate).not.toHaveBeenCalled();
  expect(closeDocument).toHaveBeenCalledOnce();
  expect(closeImage).toHaveBeenCalledOnce();
});
