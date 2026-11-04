import { defaultText } from '../../../../../../shared/localization/messages';
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DetailsContext } from '../../../../../../shared/conversation/detailsContext';
import { TerminalLinkMenu } from '../../../../../../shared/terminal/views/TerminalLinkMenu';
import { remoteDevelopmentUrl, websiteUrl } from '../../../../../../shared/terminal/links';
import { remoteTerminalApi } from '../../../../../../shared/remote-chat/terminalApi';
import type { TerminalApi } from '../../../../../../shared/terminal/types';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => undefined) }));
const openWebsite = vi.fn();
const close = vi.fn();
const api: TerminalApi = { open: vi.fn(), write: vi.fn(), resize: vi.fn(), close: vi.fn() };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks(); delete api.resolveLink;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(<DetailsContext.Provider value={{ openWebsite, open: vi.fn(), update: vi.fn(),
    close, openFile: vi.fn(), setConversationChanges: vi.fn(), visible: false, showingChanges: false }}>
    <TerminalLinkMenu target={{ url: 'http://localhost:3002/path?q=1#here', x: 20, y: 20 }} id="terminal"
      api={api} close={close} translate={defaultText} />
  </DetailsContext.Provider>));
}
async function click(text: string) {
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === text)!.click());
}

it.each(['内部预览', '在浏览器中打开'])('opens local terminal links with %s', async action => {
  await render(); await click(action);
  expect(action === '内部预览' ? openWebsite : openUrl).toHaveBeenCalledWith('http://localhost:3002/path?q=1#here');
  expect(close).toHaveBeenCalledOnce();
});

it.each(['内部预览', '在浏览器中打开'])('resolves the selected remote computer before %s', async action => {
  api.resolveLink = vi.fn(async () => 'http://127.0.0.1:54321/path?q=1#here');
  await render(); await click(action);
  expect(api.resolveLink).toHaveBeenCalledWith('terminal', 'http://localhost:3002/path?q=1#here');
  expect(action === '内部预览' ? openWebsite : openUrl).toHaveBeenCalledWith('http://127.0.0.1:54321/path?q=1#here');
});

it('does not fall back to local localhost if the remote computer cannot open its server', async () => {
  api.resolveLink = vi.fn(async () => { throw new Error('无法连接网页，请确认服务已启动。'); });
  await render(); await click('内部预览');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('确认服务已启动');
  expect(openWebsite).not.toHaveBeenCalled(); expect(openUrl).not.toHaveBeenCalled();
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
