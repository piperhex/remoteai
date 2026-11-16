// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceTabActions } from '../../../../../shared/conversation/useWorkspaceTabActions';

let root: Root;
let host: HTMLDivElement;
let actions: ReturnType<typeof useWorkspaceTabActions>;
type Options = Parameters<typeof useWorkspaceTabActions>[0];
function Fixture({ options }: { options: Options }) { actions = useWorkspaceTabActions(options); return null; }
const defaults = (): Options => ({ launchers: new Map(), entries: [], openTabs: [], openTab: vi.fn() });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (options: Options) => act(async () => root.render(<Fixture options={options} />));

it('offers no additions when the host has no available capabilities', async () => {
  const open = vi.fn();
  await render({ ...defaults(), launchers: new Map([
    ['git', { id: 'git', tabId: 'git:/project', enabled: false, open }],
    ['files', { id: 'files', tabId: 'files:/project', enabled: false, open }],
  ]) });
  expect(actions).toEqual([]);
  expect(open).not.toHaveBeenCalled();
});

it('removes open tabs from additions and restores a closed tab using the existing launcher', async () => {
  const open = vi.fn();
  const options: Options = { ...defaults(), openBrowser: vi.fn(),
    launchers: new Map([['files', { id: 'files', tabId: 'files:/project', enabled: true, open }]]),
    entries: [{ id: 'files:/project', title: 'Files' }],
    openTabs: [{ id: 'files:/project', title: 'Files' }, { id: 'preview', title: 'Browser' }],
  };
  await render(options); expect(actions).toEqual([]);
  await render({ ...options, openTabs: [{ id: 'preview', title: 'Browser' }] });
  expect(actions.map(action => action.id)).toEqual(['files:/project']);
  actions[0].open(); expect(open).toHaveBeenCalledOnce();
});

it('keeps the current project available when only another project tab is open', async () => {
  const open = vi.fn();
  await render({ ...defaults(),
    launchers: new Map([['git', { id: 'git', tabId: 'git:/current', enabled: true, open }]]),
    openTabs: [{ id: 'git:/other', title: 'Git' }],
  });
  expect(actions.map(action => action.id)).toEqual(['git:/current']);
  actions[0].open(); expect(open).toHaveBeenCalledOnce();
});

it('reopens available changes and retained auxiliary panels without duplicating open tabs', async () => {
  const showChanges = vi.fn(), openTab = vi.fn();
  await render({ ...defaults(), showChanges, openTab,
    entries: [{ id: 'review', title: 'Review' }, { id: 'history', title: 'History' }],
    openTabs: [{ id: 'history', title: 'History' }],
  });
  expect(actions.map(action => action.id)).toEqual(['changes', 'review']);
  actions[0].open(); actions[1].open();
  expect(showChanges).toHaveBeenCalledOnce(); expect(openTab).toHaveBeenCalledWith('review');
});
