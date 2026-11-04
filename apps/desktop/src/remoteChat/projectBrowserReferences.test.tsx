// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatFileReferencesProvider, useChatFileReference, useChatFileSelection,
  useComposerFileReferences } from '../../../../shared/chat/ChatFileReferences';
import { useComposerAttachments } from '../../../../shared/remote-chat/views/useComposerAttachments';

let root: Root;
let reference: ReturnType<typeof useChatFileReference>;
let attachments: ReturnType<typeof useComposerAttachments>;
const focus = vi.fn();
const addQuote = vi.fn(() => true);
let quoteSelection: ReturnType<typeof useChatFileSelection>;
const file = { path: 'D:/remote/文件 name.ts', name: '文件 name.ts', directory: false };
function Browser() { reference = useChatFileReference(); quoteSelection = useChatFileSelection(); return null; }
function Composer({ scope, enabled }: { scope: string; enabled: boolean }) {
  attachments = useComposerAttachments({ threadId: scope, sending: false });
  useComposerFileReferences({ scope, enabled, add: attachments.add, addQuote, focus });
  return null;
}
async function render(scope = 'a', enabled = true, mounted = true) {
  await act(async () => root.render(<StrictMode><ChatFileReferencesProvider>
    <Browser />{mounted && <Composer scope={scope} enabled={enabled} />}
  </ChatFileReferencesProvider></StrictMode>));
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  focus.mockClear();
  addQuote.mockReset().mockReturnValue(true);
  root = createRoot(document.createElement('div'));
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it('adds file and folder references once and focuses only when the browser is closed', () => {
  let afterClose!: () => void;
  act(() => { afterClose = reference(file); });
  expect(focus).not.toHaveBeenCalled();
  act(() => { reference(file); });
  act(() => { reference({ path: 'D:/remote/src', name: 'src', directory: true }); });
  expect(attachments.items).toEqual([
    { kind: 'file', path: file.path, name: file.name },
    { kind: 'folder', path: 'D:/remote/src', name: 'src' },
  ]);
  afterClose();
  expect(focus).toHaveBeenCalledOnce();
});

it('quotes the selected snapshot and focuses only its own conversation after closing the browser', async () => {
  const selection = { path: file.path, start: { line: 2, column: 3 }, end: { line: 2, column: 8 }, text: 'draft' };
  const afterClose = quoteSelection(selection);
  expect(addQuote).toHaveBeenCalledWith({ messageId: `file:${file.path}:2:3-2:8`, source: 'file',
    text: `${file.path}:2:3-2:8\n\`\`\`\ndraft\n\`\`\`` });
  expect(focus).not.toHaveBeenCalled();
  expect(attachments.items).toEqual([]);
  await render('b');
  afterClose();
  expect(focus).not.toHaveBeenCalled();
  quoteSelection(selection)();
  expect(focus).toHaveBeenCalledOnce();
  addQuote.mockReturnValue(false);
  expect(() => quoteSelection(selection)).toThrow('引用数量');
  expect(() => quoteSelection({ ...selection, text: 'x'.repeat(16_001) })).toThrow('缩小引用范围');
  await render('b', false);
  expect(() => quoteSelection(selection)).toThrow('聊天可用');
});

it('keeps rejected references out of the draft and permits duplicates at the limit', () => {
  for (let index = 0; index < 8; index++) {
    act(() => { reference({ ...file, path: `D:/remote/${index}` }); });
  }
  act(() => { expect(() => reference(file)).toThrow('附件数量'); });
  expect(attachments.items).toHaveLength(8);
  act(() => { reference({ ...file, path: 'D:/remote/0' }); });
  expect(attachments.items).toHaveLength(8);
});

it('drops unavailable receivers and does not focus a different conversation after a delayed close', async () => {
  let afterClose!: () => void;
  act(() => { afterClose = reference(file); });
  await render('b');
  expect(attachments.items).toEqual([]);
  afterClose();
  expect(focus).not.toHaveBeenCalled();
  await render('b', false);
  expect(() => reference(file)).toThrow('聊天可用');
  await render('b', true, false);
  expect(() => reference(file)).toThrow('聊天可用');
});

it('does not route an inactive remote workspace into another computer with the same thread ID', async () => {
  let inactiveReference!: ReturnType<typeof useChatFileReference>;
  function InactiveBrowser() { inactiveReference = useChatFileReference(); return null; }
  await act(async () => root.render(<>
    <ChatFileReferencesProvider>
      <InactiveBrowser /><Composer scope="same-thread" enabled={false} />
    </ChatFileReferencesProvider>
    <ChatFileReferencesProvider>
      <Browser /><Composer scope="same-thread" enabled />
    </ChatFileReferencesProvider>
  </>));
  expect(() => inactiveReference(file)).toThrow('聊天可用');
  expect(attachments.items).toEqual([]);
  act(() => { reference(file); });
  expect(attachments.items).toEqual([{ kind: 'file', path: file.path, name: file.name }]);
});
