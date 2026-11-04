import { expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { fileSelectionQuote, selectedFileText } from '../../../../shared/project-browser/fileSelection';
import { quotedReply } from '../../../../shared/conversation/replyQuotes';
import { quotedMessage } from '../../../../shared/chat/quotedMessage';

it('captures exact whitespace and one-based positions from a reversed CRLF selection', () => {
  const state = EditorState.create({ doc: 'zero\r\n  中文\tvalue\r\nlast',
    extensions: EditorState.lineSeparator.of('\r\n'), selection: EditorSelection.single(17, 7) });
  expect(selectedFileText(state, 'F:\\project\\文件.ts')).toEqual({
    path: 'F:\\project\\文件.ts', start: { line: 2, column: 3 }, end: { line: 3, column: 2 },
    text: '中文\tvalue\r\nl',
  });
  expect(selectedFileText(EditorState.create({ doc: 'hello' }), '/a')).toBeNull();
});

it('keeps fenced code, its location and user text intact through sending and history parsing', () => {
  const quote = fileSelectionQuote({ path: '/project/含 空格.md',
    start: { line: 4, column: 2 }, end: { line: 6, column: 1 }, text: '  ```ts\ncode\n' });
  expect(quote.text).toBe('/project/含 空格.md:4:2-6:1\n````\n  ```ts\ncode\n\n````');
  const sent = quotedReply('请修改这里', [quote]);
  expect(sent.startsWith('引用文件内容：\n')).toBe(true);
  expect(quotedMessage(sent)).toEqual({ quotes: [quote.text], text: '请修改这里' });
  expect(quotedReply('', [quote, { messageId: 'reply', text: 'answer' }])).toContain('引用对话内容：');
});
