// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileDropEvent } from '../../../../../shared/chat/useFileDrop';
import { Composer } from './Composer';
import { GuiController } from './controller';
import { guiApi } from '../../../../../shared/conversation/api';
import { invoke } from '../../api/backend';
import { droppedReferences, subscribeFileDrop } from './fileDrop';
import { testModels } from '../../../../../shared/conversation/testing/models';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock('../../api/backend', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/backend')>(), invoke: vi.fn(), isDesktopApp: true,
}));
vi.mock('./fileDrop', () => ({ droppedReferences: vi.fn(), subscribeFileDrop: vi.fn() }));
vi.mock('./UsageStatus', () => ({ UsageStatus: () => null }));
vi.mock('./ProjectPicker', () => ({ ProjectPicker: () => null }));
vi.mock('./AccessPicker', () => ({ AccessPicker: () => null }));
vi.mock('./ModelPicker', () => ({ ModelPicker: () => null }));

const thumbnail = 'data:image/png;base64,iVBORw0KGgo=';
const photo = { kind: 'file' as const, name: 'photo.PNG', path: 'C:/photo.PNG' };
const file = { kind: 'file' as const, name: 'notes.txt', path: 'C:/notes.txt' };
let controller: GuiController;
let root: Root;
let host: HTMLDivElement;
let listener: (event: FileDropEvent) => void;
function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <Composer state={state} controller={controller} active />;
}
const drop = () => listener({ type: 'drop', paths: [photo.path, file.path], position: { x: 10, y: 10 } });

beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
  });
  vi.mocked(subscribeFileDrop).mockImplementation(async callback => {
    listener = callback; return vi.fn<() => void>();
  });
  vi.mocked(droppedReferences).mockResolvedValue([photo, file]);
  vi.mocked(invoke).mockResolvedValue({ url: thumbnail });
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'models') return { data: testModels, nextCursor: null };
    if (request.operation === 'list') return { data: [], nextCursor: null };
    if (request.operation === 'projectDirectories') return { directory: request.directory };
    return { thread: { id: 'existing', cwd: '', preview: 'hello', updatedAt: 1, turns: [] } };
  });
  controller = new GuiController(); await controller.connect();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); controller.dispose();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('adds mixed native files, previews images, deduplicates repeated drops and sends references', async () => {
  const send = vi.spyOn(controller, 'send').mockResolvedValue(true);
  await act(async () => drop());
  await act(async () => drop());
  expect(host.querySelectorAll('img')).toHaveLength(1);
  expect(host.querySelector('img')?.src).toBe(thumbnail);
  expect(host.querySelector('[aria-label="文件、插件和对话引用"]')?.textContent).toBe('notes.txt');
  await act(async () => host.querySelector('[role="textbox"]')!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  ));
  expect(send).toHaveBeenCalledWith('', [], [], [photo, file]);
  expect(host.querySelector('img')).toBeNull();
});

it('does not add a late native drop to a different conversation', async () => {
  let finish!: (references: typeof file[]) => void;
  vi.mocked(droppedReferences).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => drop());
  await act(async () => controller.select('existing'));
  await act(async () => finish([photo, file]));
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('[aria-label="文件、插件和对话引用"]')).toBeNull();
});

it('selects new-conversation folders as projects while attaching files', async () => {
  vi.mocked(droppedReferences).mockResolvedValueOnce([
    { kind: 'folder', name: 'project', path: 'C:/project' }, file,
  ]);
  await act(async () => drop());
  expect(controller.getSnapshot().settings.cwd).toBe('C:/project');
  expect(host.querySelector('[aria-label="文件、插件和对话引用"]')?.textContent).toBe('notes.txt');
});
