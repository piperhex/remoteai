// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceDrawer } from '../../../../../shared/chat/useWorkspaceDrawer';
import type { WorkspaceTabs } from '../../../../../shared/chat/workspaceDrawer';

const ORDER = ['changes', 'browser', 'files', 'git'];
let root: Root;
let host: HTMLDivElement;
let tabs: WorkspaceTabs;
function Fixture() { tabs = useWorkspaceDrawer(true).tabs; return null; }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('closes all other tabs in one update and selects the surviving target', async () => {
  await act(async () => tabs.open('git'));
  await act(async () => tabs.closeMany(['changes', 'browser', 'git'], ORDER));
  expect(tabs.selected).toBe('files');
  expect(tabs.visible).toBe(true);
  expect([...tabs.closed]).toEqual(['changes', 'browser', 'git']);
});

it('selects the nearest remaining tab when the active tab is closed to the right', async () => {
  await act(async () => tabs.open('git'));
  await act(async () => tabs.closeMany(['files', 'git'], ORDER));
  expect(tabs.selected).toBe('browser');
  expect([...tabs.closed]).toEqual(['files', 'git']);
});

it('keeps the active tab when closing other tabs and can reopen retained tabs', async () => {
  await act(async () => tabs.open('browser'));
  await act(async () => tabs.closeMany(['files', 'git'], ORDER));
  expect(tabs.selected).toBe('browser');
  await act(async () => tabs.open('files'));
  expect(tabs.selected).toBe('files');
  expect([...tabs.closed]).toEqual(['git']);
});

it('leaves an empty close request unchanged and hides only after the last tab closes', async () => {
  await act(async () => tabs.open('browser'));
  await act(async () => tabs.closeMany([], ORDER));
  expect(tabs.selected).toBe('browser');
  expect(tabs.closed.size).toBe(0);
  await act(async () => tabs.close('browser', ['browser']));
  expect(tabs.selected).toBeNull();
  expect(tabs.visible).toBe(false);
});
