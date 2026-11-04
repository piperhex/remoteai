// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import type { DragDropEvent } from '@tauri-apps/api/webview';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Composer } from './Composer';
import { GuiController } from './controller';
import { guiApi } from '../../../../../shared/conversation/api';
import { invoke } from '../../api/backend';
import { readProjects, saveProject } from '../../../../../shared/conversation/projectCatalog';
import type { AttachmentReference } from '../../../../../shared/conversation/attachmentTypes';
import { testModels } from '../../../../../shared/conversation/testing/models';

const native = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: native.listen }),
}));
vi.mock('@tauri-apps/api/core', async importOriginal => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(), invoke: native.invoke,
}));
vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock('../../api/backend', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/backend')>(), invoke: vi.fn(), isDesktopApp: true,
}));
vi.mock('./UsageStatus', () => ({ UsageStatus: () => null }));
vi.mock('../../../../../shared/conversation/WorkspacePicker', () => ({ WorkspacePicker: () => null }));
vi.mock('../../../../../shared/conversation/GuiToolbox', () => ({ GuiToolbox: () => null }));
vi.mock('./AccessPicker', () => ({ AccessPicker: () => null }));
vi.mock('./ModelPicker', () => ({ ModelPicker: () => null }));

const oldPath = 'C:/old-project';
const folder = { kind: 'folder' as const, path: 'C:/new-project', name: 'new-project' };
const file = { kind: 'file' as const, path: 'C:/notes.txt', name: 'notes.txt' };
const photo = { kind: 'file' as const, path: 'C:/图片.PNG', name: '图片.PNG' };
const thumbnail = 'data:image/png;base64,iVBORw0KGgo=';
const listeners = new Set<(event: { payload: DragDropEvent }) => void>();
let controller: GuiController;
let root: Root;
let host: HTMLDivElement;
let granted: boolean;
let references: AttachmentReference[];
let finishValidation: (result: { directory: string }) => void;

function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <Composer state={state} controller={controller} active />;
}

beforeEach(async () => {
  vi.clearAllMocks(); listeners.clear(); localStorage.clear(); granted = false; references = [folder];
  saveProject({ path: folder.path, name: '用户自定义项目名称' });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ media, matches: false, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
  });
  native.listen.mockImplementation(async listener => {
    listeners.add(listener); return () => listeners.delete(listener);
  });
  native.invoke.mockImplementation(async command => {
    if (command !== 'codex_gui_dropped_files') throw new Error(`Unexpected command: ${command}`);
    // Match the host: the same native drop may be read exactly once by the whole composer.
    if (!granted) throw '请重新将文件拖入输入框。';
    granted = false;
    return { references, files: [] };
  });
  vi.mocked(invoke).mockResolvedValue({ url: thumbnail });
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
  vi.mocked(guiApi.request).mockImplementation(async request => {
    if (request.operation === 'models') return { data: testModels, nextCursor: null };
    if (request.operation === 'list') return { data: [], nextCursor: null };
    if (request.operation === 'projectDirectories') return new Promise(resolve => { finishValidation = resolve; });
    return { thread: { id: 'existing', cwd: oldPath, preview: '', updatedAt: 1, turns: [] } };
  });
  controller = new GuiController(); await controller.connect(); controller.setProject(oldPath);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); controller.dispose();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function emitDrop() {
  granted = true;
  const payload = { type: 'drop' as const, paths: references.map(item => item.path),
    position: new PhysicalPosition(10, 10) };
  for (const listener of listeners) listener({ payload });
}
const editor = () => host.querySelector<HTMLElement>('[role="textbox"]')!;
const enter = () => editor().dispatchEvent(new KeyboardEvent('keydown',
  { key: 'Enter', bubbles: true, cancelable: true }));
const submit = () => host.querySelector<HTMLButtonElement>('[aria-label="发送消息"]')!;
const writeDraft = () => act(async () => {
  editor().textContent = '检查这个项目'; editor().dispatchEvent(new InputEvent('input', { bubbles: true }));
});

it.each(['Enter', 'button'])('blocks %s during project validation, then uses the new directory', async method => {
  const sentPaths: string[] = [];
  vi.spyOn(controller, 'send').mockImplementation(async () => {
    sentPaths.push(controller.getSnapshot().settings.cwd); return true;
  });
  await writeDraft();
  await act(async () => emitDrop());
  expect(submit().disabled).toBe(true);
  await act(async () => { if (method === 'Enter') enter(); else submit().click(); });
  expect(sentPaths).toEqual([]);
  await act(async () => finishValidation({ directory: folder.path }));
  expect(submit().disabled).toBe(false);
  await act(async () => { if (method === 'Enter') enter(); else submit().click(); });
  expect(sentPaths).toEqual([folder.path]);
});

it('blocks Enter immediately in the same event batch as a native drop', async () => {
  const send = vi.spyOn(controller, 'send').mockResolvedValue(true);
  await writeDraft();
  await act(async () => { emitDrop(); enter(); });
  expect(send).not.toHaveBeenCalled();
});

it('preserves saved names and consumes only one grant for a mixed project, file and image drop', async () => {
  references = [folder, file, photo];
  await act(async () => emitDrop());
  await act(async () => finishValidation({ directory: folder.path }));
  expect(native.invoke).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().settings.cwd).toBe(folder.path);
  expect(readProjects().find(project => project.path === folder.path)?.name).toBe('用户自定义项目名称');
  expect(host.querySelector('[aria-label="文件、插件和对话引用"]')?.textContent).toBe('notes.txt');
  expect(host.querySelector('img')?.src).toBe(thumbnail);
  expect(controller.getSnapshot().error).toBe('');
});

it.each([[file], [photo], [file, photo]])('accepts attachment-only drops once: %j', async (...items) => {
  references = items;
  await act(async () => emitDrop());
  expect(native.invoke).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().settings.cwd).toBe(oldPath);
  expect(controller.getSnapshot().error).toBe('');
  expect(host.querySelectorAll('img')).toHaveLength(items.includes(photo) ? 1 : 0);
  expect(submit().disabled).toBe(false);
});

it('does not change projects or attach late files after switching conversations', async () => {
  references = [folder, file];
  await act(async () => emitDrop());
  await act(async () => controller.select('existing'));
  await act(async () => finishValidation({ directory: folder.path }));
  expect(controller.getSnapshot().settings.cwd).toBe(oldPath);
  expect(host.querySelector('[aria-label="文件、插件和对话引用"]')).toBeNull();
});

it('keeps folders as attachments in an existing conversation', async () => {
  await act(async () => controller.select('existing'));
  await act(async () => emitDrop());
  expect(native.invoke).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[aria-label="文件、插件和对话引用"]')?.textContent).toBe(folder.name);
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'projectDirectories' }));
});

it('rejects multiple project folders without changing the project or losing the draft', async () => {
  references = [folder, { ...folder, path: 'C:/other-project' }];
  await writeDraft();
  await act(async () => emitDrop());
  expect(controller.getSnapshot().settings.cwd).toBe(oldPath);
  expect(controller.getSnapshot().error).toContain('请一次拖入一个文件夹');
  expect(editor().textContent).toBe('检查这个项目');
  expect(submit().disabled).toBe(false);
});

it('recovers from failed directory validation and keeps internal errors out of the UI', async () => {
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  vi.mocked(guiApi.request).mockImplementation(request => request.operation === 'projectDirectories'
    ? Promise.reject(new Error('internal path and credential')) : original(request));
  await writeDraft();
  await act(async () => emitDrop());
  expect(controller.getSnapshot().settings.cwd).toBe(oldPath);
  expect(controller.getSnapshot().error).toBe('无法使用此文件夹，请选择可访问的文件夹。');
  expect(submit().disabled).toBe(false);
});
