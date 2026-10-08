// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Composer } from './Composer';
import { GuiController } from './controller';
import { guiApi } from './api';
import { testModels } from './testModels';

vi.mock('./api', () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock('./UsageStatus', () => ({ UsageStatus: () => <span data-testid="usage" /> }));
vi.mock('./ProjectPicker', () => ({ ProjectPicker: () => null }));
vi.mock('./AccessPicker', () => ({ AccessPicker: () => null }));
vi.mock('./ModelPicker', () => ({ ModelPicker: () => null }));
const thread = { id: 'one', cwd: '', preview: '', updatedAt: 1, turns: [] };
let controller: GuiController;
let host: HTMLDivElement;
let root: Root;
let failGoal: boolean;
function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return <Composer state={state} controller={controller} active />;
}
const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"][aria-label="消息"]')!;
async function type(text: string) {
  await act(async () => {
    editor().textContent = text;
    const range = document.createRange(); range.setStart(editor().firstChild!, text.length); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    editor().dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}
async function chooseGoal() {
  await type('/goal');
  expect(host.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('命令和技能');
  await act(async () => host.querySelector<HTMLButtonElement>('[role="option"]')!.click());
}
beforeEach(async () => {
  vi.resetAllMocks(); localStorage.clear(); failGoal = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(() => {});
  vi.mocked(guiApi.request).mockImplementation(async (body) => {
    if (body.operation === 'models') return { data: testModels, nextCursor: null };
    if (body.operation === 'skills' || body.operation === 'list') return { data: [] };
    if (body.operation === 'goalSet') {
      if (failGoal) throw new Error('failed');
      return { goal: { threadId: thread.id, objective: body.objective, status: 'active' } };
    }
    if (body.operation === 'goalGet') return { goal: null };
    return { thread };
  });
  controller = new GuiController(); await controller.connect();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); controller.dispose(); vi.unstubAllGlobals();
});

it('selects /goal inline, places its removable capsule immediately before usage, and preserves the draft on cancel', async () => {
  await chooseGoal();
  expect(editor().textContent).toBe('');
  const remove = host.querySelector<HTMLButtonElement>('[aria-label="移除目标"]')!;
  expect(remove.parentElement?.nextElementSibling?.getAttribute('data-testid')).toBe('usage');
  await type('完成登录页面');
  await act(async () => remove.click());
  expect(host.querySelector('[aria-label="移除目标"]')).toBeNull();
  expect(editor().textContent).toBe('完成登录页面');
  expect(guiApi.request).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'goalSet' }));
});

it('keeps a failed first goal editable, starts it on retry, and clears its persisted goal through the capsule', async () => {
  await chooseGoal(); await type('完成登录页面'); failGoal = true;
  const send = () => host.querySelector<HTMLButtonElement>('[aria-label="发送消息"]')!.click();
  await act(async () => send());
  expect(controller.getSnapshot().selected).toBe(thread.id);
  expect(editor().textContent).toBe('完成登录页面');
  expect(editor().getAttribute('data-placeholder')).toBe('描述想完成的目标…');
  failGoal = false;
  await act(async () => send());
  expect(editor().textContent).toBe('');
  expect(controller.getSnapshot().goals?.one?.objective).toBe('完成登录页面');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除目标"]')!.click());
  expect(guiApi.request).toHaveBeenCalledWith({ operation: 'goalClear', threadId: thread.id });
  expect(host.querySelector('[aria-label="移除目标"]')).toBeNull();
});
