// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RemoteUserMessage } from './RemoteUserMessage';
import { initialChatState, type Thread } from '../../../../../../shared/remote-chat/client/types';
import { ChatController } from '../../../../../../shared/remote-chat/client/controller';
import { guiApi } from '../../../../../../shared/conversation/api';

vi.mock('../../../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn() } }));
const thread: Thread = { id: 'thread', cwd: 'D:/remote', preview: '', updatedAt: 1, turns: [
  { id: 'first', status: 'completed', items: [{ id: 'old', type: 'userMessage',
    content: [{ type: 'text', text: 'earlier' }] }] },
  { id: 'last', status: 'completed', items: [{ id: 'user', type: 'userMessage',
    content: [{ type: 'text', text: 'latest' }] }] },
] };
const state = { ...initialChatState(), ready: true, selected: thread };
let root: Root;
let host: HTMLDivElement;
let controller: ChatController;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')]
  .find(button => button.getAttribute('aria-label') === label || button.textContent === label)!;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  controller = new ChatController(() => ({ request: vi.fn(), start: vi.fn(), stop: vi.fn() }));
  vi.spyOn(controller.messageEditor, 'submit').mockResolvedValue(true);
  vi.spyOn(controller.messageEditor, 'remove').mockResolvedValue(true);
  vi.spyOn(controller, 'loadComposerCatalog').mockResolvedValue({ data: [{ errors: [], skills: [
    { name: 'remote-skill', path: 'D:/remote/SKILL.md', description: 'remote only', enabled: true },
  ] }] });
  await act(async () => root.render(<>{thread.turns!.map(turn => <RemoteUserMessage key={turn.id}
    item={turn.items[0]} turn={turn} state={state} controller={controller} active />)}</>));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); controller.stop();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('uses the local copy/edit actions and submits only the latest message to the remote controller', async () => {
  expect(host.querySelectorAll('[aria-label="编辑消息"]')).toHaveLength(1);
  expect(host.textContent).not.toContain('引用');
  await act(async () => button('编辑消息').click());
  expect(button('删除消息')).toBeTruthy();
  await act(async () => button('发送').click());
  expect(controller.messageEditor.submit).toHaveBeenCalledExactlyOnceWith({
    threadId: 'thread', turnId: 'last', itemId: 'user', text: 'latest',
  });
  expect(guiApi.request).not.toHaveBeenCalled();
});

it('loads edit skills from the remote computer', async () => {
  await act(async () => button('编辑消息').click());
  const editor = host.querySelector('[role="textbox"]')!;
  await act(async () => {
    editor.textContent = '/';
    const range = document.createRange(); range.setStart(editor.firstChild!, 1); range.collapse(true);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  expect(controller.loadComposerCatalog).toHaveBeenCalledWith('D:/remote');
  expect(host.textContent).toContain('remote-skill');
  expect(guiApi.request).not.toHaveBeenCalled();
});
