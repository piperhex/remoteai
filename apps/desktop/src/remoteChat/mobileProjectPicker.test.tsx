// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMobileProjectPicker } from '../../../../shared/remote-chat/client/useMobileProjectPicker';
import type { ProjectDirectoriesResponse, ProjectPickerProps } from '../../../../shared/remote-chat/projectDirectories';

let root: Root;
let picker: ReturnType<typeof useMobileProjectPicker>;
const response = (directory: string): ProjectDirectoriesResponse => ({ directory,
  parent: directory === '/work' ? '/' : null, truncated: false,
  entries: [{ name: 'Design', path: `${directory}/Design`, modified: 1 },
    { name: 'Apps', path: `${directory}/Apps` }, { name: 'README.md', path: `${directory}/README.md`, directory: false }],
  ...(directory ? {} : { shortcuts: { desktop: '/redirected/Desktop', documents: '/redirected/Documents' } }),
});
let props: ProjectPickerProps;
function Fixture() { picker = useMobileProjectPicker(props); return null; }
const render = () => act(async () => { root.render(<Fixture />); });
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  props = { cwd: '/work', load: vi.fn(async directory => response(directory)),
    mutate: vi.fn(async () => ({ path: '/work/New', directory: true })),
    projects: [{ cwd: '/recent', label: 'Recent' }, { cwd: '/recent', label: 'Duplicate' }],
    choose: vi.fn(), close: vi.fn() };
  root = createRoot(document.createElement('div'));
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('resolves host shortcuts, filters folders and retains the full current path', async () => {
  expect(picker.shortcuts?.documents).toBe('/redirected/Documents');
  expect(picker.entries.map(entry => entry.name)).toEqual(['Design', 'Apps']);
  await act(async () => picker.setQuery('des'));
  expect(picker.entries.map(entry => entry.name)).toEqual(['Design']);
  expect(picker.directory).toBe('/work');
  expect(picker.canChoose).toBe(true);
  expect(props.choose).not.toHaveBeenCalled();
});

it('shows deduplicated recent projects without treating the list as a folder', async () => {
  await act(async () => picker.toggleRecent());
  expect(picker.entries).toEqual([{ name: 'Recent', path: '/recent', directory: true }]);
  expect(picker.canChoose).toBe(false);
  await act(async () => picker.navigate('/recent'));
  expect(picker.recent).toBe(false);
  expect(picker.directory).toBe('/recent');
  expect(picker.canChoose).toBe(true);
});

it('disables confirmation on read errors and can navigate back out of an inaccessible path', async () => {
  vi.mocked(props.load).mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => picker.navigate('/work/private'));
  expect(picker.error).toBeTruthy();
  expect(picker.directory).toBe('/work/private');
  expect(picker.parent).toBe('/work');
  expect(picker.canChoose).toBe(false);
  await act(async () => picker.navigate(picker.parent));
  expect(picker.directory).toBe('/work');
  expect(picker.canChoose).toBe(true);
});

it('validates folder names, prevents duplicate submissions and enters the created folder', async () => {
  await act(async () => { picker.openCreate(); picker.setName('../escape'); });
  await act(async () => picker.createFolder());
  expect(props.mutate).not.toHaveBeenCalled();
  await act(async () => picker.setName('New'));
  let complete!: (result: { path: string; directory: boolean }) => void;
  vi.mocked(props.mutate!).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = picker.createFolder(); });
  await act(async () => picker.createFolder());
  expect(props.mutate).toHaveBeenCalledExactlyOnceWith({ cwd: '/', path: '/work', action: 'createFolder', name: 'New' });
  await act(async () => { complete({ path: '/work/New', directory: true }); await pending; });
  expect(picker.directory).toBe('/work/New');
  expect(picker.creating).toBe(false);
  expect(props.choose).not.toHaveBeenCalled();
});

it('keeps a failed creation open for retry and does not create folders at the computer root', async () => {
  await act(async () => { picker.openCreate(); picker.setName('New'); });
  vi.mocked(props.mutate!).mockRejectedValueOnce(new Error('exists'));
  await act(async () => picker.createFolder());
  expect(picker.creating).toBe(true);
  expect(picker.actionError).toBe('client.projectExplorer.actionError');
  await act(async () => picker.navigate(''));
  expect(picker.canCreate).toBe(false);
  expect(picker.canChoose).toBe(false);
});
