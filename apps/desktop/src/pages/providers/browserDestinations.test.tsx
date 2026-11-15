// @vitest-environment jsdom
import { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserNavigationContext, BrowserNavigationProvider } from '../../../../../shared/browser/BrowserNavigationProvider';
import { BrowserClientContext } from '../../../../../shared/file-preview/workspace/browserClient';
import { useManagedBrowserTabs } from '../../../../../shared/file-preview/workspace/useManagedBrowserTabs';
import type { BrowserClient, BrowserEvent, ManagedBrowserTab } from '../../../../../shared/browser/automation';

let root: Root;
let navigation: NonNullable<React.ContextType<typeof BrowserNavigationContext>>;
let listeners: Set<(event: BrowserEvent) => void>;
const sidebar = vi.fn(), menu = vi.fn(), localRequest = vi.fn(), remoteRequest = vi.fn(async () => ({}));
let remote: BrowserClient;
const tab = (destination: ManagedBrowserTab['destination']): ManagedBrowserTab => ({
  id: crypto.randomUUID(), threadId: 'thread', url: 'https://example.com', title: 'Example', destination,
});
function Fixture({ active }: { active: boolean }) {
  navigation = useContext(BrowserNavigationContext)!;
  useManagedBrowserTabs({ threadId: 'thread', active, open: sidebar, close: vi.fn() });
  return null;
}
const render = async (active = true) => act(async () => root.render(
  <BrowserClientContext.Provider value={{ native: true, request: localRequest, subscribe: async () => () => {} }}>
    <BrowserNavigationProvider onOpen={menu}><BrowserClientContext.Provider value={remote}>
      <Fixture active={active} />
    </BrowserClientContext.Provider></BrowserNavigationProvider>
  </BrowserClientContext.Provider>));
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  listeners = new Set();
  remote = { native: false, request: remoteRequest, subscribe: async callback => {
    listeners.add(callback); return () => { listeners.delete(callback); };
  } };
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('keeps default and AgentHub tabs in the conversation while menu tabs retain their remote owner', async () => {
  await render();
  const first = tab(undefined), second = tab('agentHub'), third = tab('standalone');
  await act(async () => {
    for (const item of [first, second, third]) [...listeners].forEach(listener => listener({ type: 'opened', tab: item }));
  });
  expect(sidebar.mock.calls.map(([item]) => item.id)).toEqual([first.id, second.id]);
  expect(menu).toHaveBeenCalledTimes(1);
  expect(navigation.browser.tabs.map(item => item.id)).toEqual([third.id]);
  expect(navigation.browser.tabs[0].automationClient).toBe(remote);
  await act(async () => navigation.browser.onAction(third.id, 'reload'));
  expect(remoteRequest).toHaveBeenCalledWith({ threadId: 'thread', tabId: third.id, command: { action: 'reload' } });
  expect(localRequest).not.toHaveBeenCalled();
  await render(false);
  await act(async () => [...listeners].forEach(listener => listener({ type: 'closed', threadId: 'thread', tabId: third.id })));
  expect(navigation.browser.tabs).toHaveLength(0);
});
