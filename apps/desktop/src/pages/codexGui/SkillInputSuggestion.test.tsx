// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SkillInput } from './SkillInput';
import { readEditor } from './skillEditorDom';
import type { ComposerText } from '../../../../../shared/conversation/types';

vi.mock('../../../../../shared/conversation/api', () => ({ guiApi: { request: vi.fn().mockResolvedValue({ data: [] }) } }));
const suggestion = '按这个方案实现';
const send = vi.fn();
const dismiss = vi.fn();
let root: Root;
let host: HTMLDivElement;
function Fixture({ text = suggestion }: { text?: string }) {
  const [value, setValue] = useState<ComposerText>({ text: '', mentions: [] });
  return <SkillInput value={value} draftKey="one" cwd="" active connected disabled={false}
    suggestion={text} onUserInput={dismiss} onChange={setValue} onPaste={() => {}}
    onSend={() => send(value)} placeholder="输入消息" />;
}
const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"]')!;
const ghost = () => host.querySelector('[data-testid="next-prompt-suggestion"]');
async function key(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { editor().dispatchEvent(event); });
  return event;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'execCommand');
});

it('keeps ghost text outside the draft until Tab, then allows Enter to send the accepted draft', async () => {
  expect(ghost()?.querySelector('span')?.textContent).toBe(suggestion);
  expect(readEditor(editor())).toEqual({ text: '', mentions: [] });
  await key('Enter');
  expect(send).toHaveBeenLastCalledWith({ text: '', mentions: [] });
  send.mockClear();
  expect((await key('Tab')).defaultPrevented).toBe(true);
  expect(readEditor(editor())).toEqual({ text: suggestion, mentions: [] });
  expect(ghost()).toBeNull(); expect(send).not.toHaveBeenCalled();
  await key('Enter');
  expect(send).toHaveBeenCalledExactlyOnceWith({ text: suggestion, mentions: [] });
});

it.each(['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'isComposing'] as const)(
  'does not accept modified or composing Tab (%s)', async modifier => {
    expect((await key('Tab', { [modifier]: true })).defaultPrevented).toBe(false);
    expect(editor().textContent).toBe(''); expect(ghost()).not.toBeNull();
  });

it('hides on the first keystroke and reappears when the draft is emptied', async () => {
  await key('a'); expect(ghost()).toBeNull(); expect(dismiss).toHaveBeenCalled();
  await act(async () => {
    editor().textContent = 'a'; editor().dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await act(async () => {
    editor().textContent = ''; editor().dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  expect(ghost()).not.toBeNull();
});

it('clears when Chinese composition starts and leaves IME Tab and Enter alone', async () => {
  await act(async () => { editor().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  expect(ghost()).toBeNull();
  expect((await key('Tab')).defaultPrevented).toBe(false);
  expect((await key('Enter')).defaultPrevented).toBe(false);
  expect(send).not.toHaveBeenCalled();
  await act(async () => {
    editor().textContent = '继续检查';
    editor().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '继续检查' }));
  });
  await key('Enter'); expect(send).toHaveBeenLastCalledWith({ text: '继续检查', mentions: [] });
});

it('restores the suggestion when Chinese composition is cancelled without entering text', async () => {
  await act(async () => { editor().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  expect(ghost()).toBeNull();
  await act(async () => { editor().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });
  expect(ghost()).not.toBeNull();
});

it.each(['Backspace', 'Delete', 'Escape'])('keeps the suggestion after %s in an empty draft', async name => {
  await key(name); expect(ghost()).not.toBeNull();
});

it('clears on paste and preserves pasted plain text', async () => {
  const insert = vi.fn((_command: string, _ui: boolean, text: string) => { editor().textContent = text; return true; });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: insert });
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [], getData: (type: string) => type === 'text/plain' ? '我自己的内容' : '',
  } });
  await act(async () => { editor().dispatchEvent(event); });
  expect(ghost()).toBeNull(); expect(editor().textContent).toBe('我自己的内容');
  expect(insert).toHaveBeenCalledExactlyOnceWith('insertText', false, '我自己的内容');
});

it('accepts through the touch action without submitting', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="填入建议"]')!.click());
  expect(readEditor(editor())).toEqual({ text: suggestion, mentions: [] });
  expect(ghost()).toBeNull(); expect(send).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(editor());
});
