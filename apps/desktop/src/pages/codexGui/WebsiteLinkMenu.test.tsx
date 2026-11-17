// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MessageLink } from '../../../../../shared/conversation/MessageLink';
import { DetailsContext } from '../../../../../shared/conversation/detailsContext';
import { FileEnvironmentContext, type FileEnvironment } from '../../../../../shared/conversation/fileEnvironment';
import { BrowserNavigationContext } from '../../../../../shared/browser/BrowserNavigationProvider';
import { useWebsiteTabs } from '../../../../../shared/file-preview/workspace/useWebsiteTabs';
import { copyText } from '../../../../../shared/clipboard';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('../../../../../shared/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('antd', async original => ({ ...await original<typeof import('antd')>(), message: { error: vi.fn() } }));
const sidebar = vi.fn();
const standalone = vi.fn();
const resolveWebsite = vi.fn(async (url: string) => url);
const href = 'http://localhost:3002/guide?q=1#here';
const forwarded = 'http://127.0.0.1:54321/guide?q=1#here';
let root: Root;
let container: HTMLDivElement;
const environment: FileEnvironment = { remote: true, resolveWebsite, image: () => null,
  previews: { open: vi.fn(), close: vi.fn() }, actions: { applications: vi.fn(), perform: vi.fn() } };

function Providers({ children, remote }: { children: ReactNode; remote: boolean }) {
  const browser = useWebsiteTabs();
  return <BrowserNavigationContext.Provider value={{ browser, openWebsite: standalone,
    openResource: vi.fn(), openManaged: vi.fn() }}>
    <DetailsContext.Provider value={{ openWebsite: sidebar, open: vi.fn(), update: vi.fn(), close: vi.fn(),
      openFile: vi.fn(), setConversationChanges: vi.fn(), visible: false, showingChanges: false }}>
      <FileEnvironmentContext.Provider value={remote ? environment : null}>{children}</FileEnvironmentContext.Provider>
    </DetailsContext.Provider>
  </BrowserNavigationContext.Provider>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks(); vi.mocked(isTauri).mockReturnValue(true);
  resolveWebsite.mockResolvedValue(forwarded);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals();
});
async function render(remote = false) {
  await act(async () => root.render(<Providers remote={remote}>
    <MessageLink href={href}>使用指南</MessageLink></Providers>));
}
async function contextMenu() {
  await act(async () => container.querySelector('a')!.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })));
}
async function choose(label: string) {
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find(item => item.textContent === label)!.click());
}
const destinations = [
  { label: '右侧边浏览器', handler: sidebar },
  { label: '独立内置浏览器', handler: standalone },
  { label: '外部浏览器', handler: openUrl },
];
for (const remote of [false, true]) it.each(destinations)(`routes ${remote ? 'remote' : 'local'} links to $label`,
  async ({ label, handler }) => {
    await render(remote); await contextMenu(); await choose(label);
    const url = remote ? forwarded : href;
    expect(handler).toHaveBeenCalledWith(...(handler === openUrl ? [url] : [url, { resolved: true }]));
    expect(resolveWebsite).toHaveBeenCalledTimes(remote ? 1 : 0);
    for (const destination of destinations) if (destination.handler !== handler) {
      expect(destination.handler).not.toHaveBeenCalled();
    }
  });
it('copies the original remote link without resolving it', async () => {
  await render(true); await contextMenu(); await choose('复制链接');
  expect(copyText).toHaveBeenCalledWith(href); expect(resolveWebsite).not.toHaveBeenCalled();
});
it.each(destinations)('does not open $label when remote resolution fails', async ({ label }) => {
  resolveWebsite.mockRejectedValue(new Error('unavailable'));
  await render(true); await contextMenu(); await choose(label);
  for (const { handler } of destinations) expect(handler).not.toHaveBeenCalled();
  expect(message.error).toHaveBeenCalled();
});
it('opens the Web external destination in a new tab', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const popup = vi.spyOn(window, 'open').mockReturnValue(null);
  await render(); await contextMenu(); await choose('外部浏览器');
  expect(popup).toHaveBeenCalledWith(href, '_blank', 'noopener,noreferrer');
  expect(openUrl).not.toHaveBeenCalled(); popup.mockRestore();
});
it('supports keyboard opening and Escape without navigating', async () => {
  await render();
  await act(async () => container.querySelector('a')!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(4);
  await act(async () => document.querySelector('[role="menu"]')!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(container.querySelector('a')!.getAttribute('aria-expanded')).toBe('false');
  expect(sidebar).not.toHaveBeenCalled();
});
it('cancels a pending navigation when its conversation unmounts', async () => {
  let resolve!: (url: string) => void;
  resolveWebsite.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await render(true); await contextMenu(); await choose('独立内置浏览器');
  await act(async () => root.render(null));
  await act(async () => resolve(forwarded));
  expect(standalone).not.toHaveBeenCalled(); expect(resolveWebsite).toHaveBeenCalledOnce();
});
