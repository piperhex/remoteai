import { defaultText, displayText } from '../../../../../../shared/localization/messages';
// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DetailsContext } from '../../../../../../shared/conversation/detailsContext';
import { TerminalLinkMenu } from '../../../../../../shared/terminal/views/TerminalLinkMenu';
import { remoteDevelopmentUrl, websiteUrl } from '../../../../../../shared/terminal/links';
import { remoteTerminalApi } from '../../../../../../shared/remote-chat/terminalApi';
import type { TerminalApi } from '../../../../../../shared/terminal/types';
import { BrowserNavigationContext } from '../../../../../../shared/browser/BrowserNavigationProvider';
import { useWebsiteTabs } from '../../../../../../shared/file-preview/workspace/useWebsiteTabs';
import { isTauri } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => undefined) }));
const openWebsite = vi.fn();
const openStandalone = vi.fn();
const close = vi.fn();
const api: TerminalApi = { open: vi.fn(), write: vi.fn(), resize: vi.fn(), close: vi.fn() };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.clearAllMocks(); delete api.resolveLink;
  vi.mocked(isTauri).mockReturnValue(true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function BrowserProvider({ children }: { children: ReactNode }) {
  const browser = useWebsiteTabs();
  return <BrowserNavigationContext.Provider value={{ browser, openWebsite: openStandalone,
    openResource: vi.fn(), openManaged: vi.fn() }}>{children}</BrowserNavigationContext.Provider>;
}
async function render(id: string | undefined = 'terminal', translate = defaultText) {
  await act(async () => root.render(<BrowserProvider><DetailsContext.Provider value={{
    openWebsite, open: vi.fn(), update: vi.fn(),
    close, openFile: vi.fn(), setConversationChanges: vi.fn(), visible: false, showingChanges: false }}>
    <TerminalLinkMenu target={{ url: 'http://localhost:3002/path?q=1#here', x: 20, y: 20 }} id={id}
      api={api} close={close} translate={translate} />
  </DetailsContext.Provider></BrowserProvider>));
}
async function click(text: string) {
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === text)!.click());
}

const destinations = [
  { label: '右侧边浏览器', handler: openWebsite },
  { label: '独立内置浏览器', handler: openStandalone },
  { label: '外部浏览器', handler: openUrl },
];
it('updates all three destinations when switching languages using bundled resources', async () => {
  for (const language of ['zh', 'en', 'ja', 'ru'] as const) {
    await render('terminal', key => displayText(key, {}, language));
    const labels = [...document.querySelectorAll('button')].map(button => button.textContent);
    expect(labels).toEqual(['Sidebar', 'Standalone', 'External']
      .map(destination => displayText(`client.terminal.openIn${destination}Browser`, {}, language)));
    expect(labels.every(label => label && !label.startsWith('client.'))).toBe(true);
  }
});
function expectDestination(handler: typeof openUrl, url: string) {
  expect(handler).toHaveBeenCalledWith(...(handler === openUrl ? [url] : [url, { resolved: true }]));
  for (const destination of destinations) if (destination.handler !== handler) {
    expect(destination.handler).not.toHaveBeenCalled();
  }
}
it.each(destinations)('opens local terminal links with $label', async ({ label, handler }) => {
  await render(); await click(label);
  expectDestination(handler, 'http://localhost:3002/path?q=1#here');
  expect(close).toHaveBeenCalledOnce();
});

it.each(destinations)('resolves the selected remote computer before $label', async ({ label, handler }) => {
  api.resolveLink = vi.fn(async () => 'http://127.0.0.1:54321/path?q=1#here');
  await render(); await click(label);
  expect(api.resolveLink).toHaveBeenCalledWith('terminal', 'http://localhost:3002/path?q=1#here');
  expectDestination(handler, 'http://127.0.0.1:54321/path?q=1#here');
});

it.each(destinations)('keeps $label closed when the remote server is unavailable', async ({ label }) => {
  api.resolveLink = vi.fn(async () => { throw new Error('无法连接网页，请确认服务已启动。'); });
  await render(); await click(label);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('确认服务已启动');
  for (const { handler } of destinations) expect(handler).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('disables unavailable built-in destinations without silently opening an external browser', async () => {
  await act(async () => root.render(<TerminalLinkMenu target={{ url: 'https://example.com', x: 20, y: 20 }}
    api={api} close={close} translate={defaultText} />));
  const buttons = [...document.querySelectorAll('button')];
  expect(buttons.map(button => button.disabled)).toEqual([true, true, false]);
  expect(document.activeElement).toBe(buttons[2]);
});

it('opens the external browser as a new tab on Web', async () => {
  vi.mocked(isTauri).mockReturnValue(false);
  const popup = vi.spyOn(window, 'open').mockReturnValue(null);
  await render(); await click('外部浏览器');
  expect(popup).toHaveBeenCalledWith('http://localhost:3002/path?q=1#here', '_blank', 'noopener,noreferrer');
  expect(openUrl).not.toHaveBeenCalled();
  popup.mockRestore();
});

it('blocks duplicate opens while resolving and cancels navigation after dismissal', async () => {
  let resolve!: (url: string) => void;
  api.resolveLink = vi.fn(() => new Promise<string>(done => { resolve = done; }));
  await render(); await click('独立内置浏览器'); await click('外部浏览器');
  expect(api.resolveLink).toHaveBeenCalledOnce();
  expect([...document.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
  await act(async () => root.render(null));
  await act(async () => resolve('http://127.0.0.1:54321/'));
  for (const { handler } of destinations) expect(handler).not.toHaveBeenCalled();
});

it.each(['http://localhost:3002', 'http://127.0.0.1:3002', 'http://192.168.10.15:3002',
  'http://10.124.100.198:3002', 'http://172.16.0.5:3002', 'http://[::1]:3002', 'http://[::]:3002',
  'http://[::ffff:127.0.0.1]:3002', 'http://dev.local:3002'])('recognizes remote development address %s', url => {
  expect(remoteDevelopmentUrl(url)).toBe(true);
});
it.each(['https://example.com/path', 'http://172.32.0.1:3002', 'https://8.8.8.8'])('keeps public website %s', url => {
  expect(remoteDevelopmentUrl(url)).toBe(false);
});
it.each(['javascript:alert(1)', 'file:///C:/file', 'http://name:password@localhost', 'not a url'])('rejects %s', url => {
  expect(websiteUrl(url)).toBeUndefined();
});

it('never opens remote loopback on this computer without a tunnel', async () => {
  const client = { open: vi.fn(), list: vi.fn(), read: vi.fn(), write: vi.fn(), resize: vi.fn(), close: vi.fn() };
  const remote = remoteTerminalApi(client);
  await expect(remote.resolveLink!('terminal', 'http://localhost:3002')).rejects.toThrow('桌面端');
  await expect(remote.resolveLink!('terminal', 'https://example.com')).resolves.toBe('https://example.com');
});
