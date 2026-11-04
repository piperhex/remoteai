// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileEnvironmentContext, type FileEnvironment } from '../../../../../../shared/conversation/fileEnvironment';
import { useWebsiteTabs } from '../../../../../../shared/file-preview/workspace/useWebsiteTabs';
import { placeBrowser } from '../../../../../../shared/file-preview/workspace/nativeBrowserPlacement';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
let tabs: ReturnType<typeof useWebsiteTabs>;
let root: Root;
let host: HTMLDivElement;
const resolves = new Map<string, (value: string) => void>();
const environment: FileEnvironment = {
  remote: true, image: () => null,
  previews: { open: async () => null, close: async () => {} },
  actions: { applications: async () => [], perform: async target => ({ path: target.path, saved: false }) },
  resolveWebsite: url => new Promise(resolve => resolves.set(url, resolve)),
};
function State() { tabs = useWebsiteTabs(); return null; }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); root = createRoot(host);
  await act(async () => root.render(<FileEnvironmentContext.Provider value={environment}>
    <State />
  </FileEnvironmentContext.Provider>));
});
afterEach(async () => { await act(async () => root.unmount()); resolves.clear(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it('preserves click order and the selected tab when remote addresses finish in reverse order', async () => {
  await act(async () => { tabs.open('https://one.test'); tabs.open('https://two.test'); });
  const [first, second] = tabs.tabs.map(tab => tab.id);
  expect(tabs.activeId).toBe(second);
  await act(async () => resolves.get('https://two.test')!('https://resolved.test/two'));
  await act(async () => resolves.get('https://one.test')!('https://resolved.test/one'));
  expect(tabs.tabs.map(tab => tab.url)).toEqual(['https://resolved.test/one', 'https://resolved.test/two']);
  expect(tabs.activeId).toBe(second);
  await act(async () => tabs.open('https://one.test'));
  expect(tabs.tabs).toHaveLength(2); expect(tabs.activeId).toBe(first);
});

it('does not restore closed tabs or previous conversations when a pending address resolves', async () => {
  await act(async () => tabs.open('https://one.test'));
  await act(async () => tabs.onCloseTab(tabs.tabs[0].id));
  await act(async () => resolves.get('https://one.test')!('https://resolved.test/one'));
  expect(tabs.tabs).toEqual([]);
  await act(async () => tabs.open('https://two.test'));
  await act(async () => tabs.reset());
  await act(async () => resolves.get('https://two.test')!('https://resolved.test/two'));
  expect(tabs.tabs).toEqual([]); expect(tabs.activeId).toBe('');
});

it('keeps resource sessions through tab switches, reuses their tabs and releases each exactly once', async () => {
  const first = { key: 'first', title: 'first.html', url: 'file:///first.html', render: () => null, release: vi.fn() };
  const second = { key: 'second', title: 'second.pdf', url: 'file:///second.pdf', render: () => null, release: vi.fn() };
  await act(async () => { tabs.openResource(first); tabs.openResource(second); });
  const firstId = tabs.tabs[0].id;
  await act(async () => tabs.selectResource('first'));
  await act(async () => tabs.openResource(first));
  expect(tabs.activeId).toBe(firstId);
  expect(first.release).not.toHaveBeenCalled(); expect(second.release).not.toHaveBeenCalled();
  const duplicate = { ...first, release: vi.fn() };
  await act(async () => tabs.openResource(duplicate));
  expect(tabs.tabs).toHaveLength(2); expect(duplicate.release).toHaveBeenCalledOnce();
  await act(async () => tabs.onCloseTab(firstId));
  expect(first.release).toHaveBeenCalledOnce(); expect(second.release).not.toHaveBeenCalled();
  await act(async () => tabs.reset());
  expect(first.release).toHaveBeenCalledOnce(); expect(second.release).toHaveBeenCalledOnce();
});

it('can return from a website to a file resource without resolving a local file as a remote URL', async () => {
  await act(async () => tabs.openResource({ key: 'file', title: 'demo.html', url: 'file:///demo.html', render: () => null }));
  const id = tabs.activeId;
  await act(async () => tabs.onNavigate(id, 'https://example.test'));
  await act(async () => resolves.get('https://example.test')!('https://example.test'));
  expect(tabs.tabs[0].url).toBe('https://example.test');
  await act(async () => tabs.onAction(id, 'back'));
  expect(tabs.tabs[0].url).toBe('file:///demo.html');
  expect(tabs.tabs[0].title).toBe('demo.html');
  await act(async () => tabs.onNavigate(id, 'https://pending.test'));
  await act(async () => tabs.selectResource('file'));
  await act(async () => resolves.get('https://pending.test')!('https://pending.test'));
  expect(tabs.tabs[0].url).toBe('file:///demo.html');
});

it('parks a native tab only after its previous placement has completed', async () => {
  let finish!: () => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  vi.mocked(invoke).mockResolvedValueOnce(undefined);
  const request = { threadId: 'thread', tabId: 'tab', visible: true, bounds: { x: 0, y: 0, width: 100, height: 100 } };
  const visible = placeBrowser(request);
  const hidden = placeBrowser({ ...request, visible: false });
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  finish(); await visible; await hidden;
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_browser_place', { request: { ...request, visible: false } });
});
