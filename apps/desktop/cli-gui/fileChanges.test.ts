import { expect, it } from 'vitest';
import type { ToolCallDetail, ToolCallTimelineItem } from '@getpaseo/protocol/agent-types';
import type { CliHistory } from '../../../shared/cli-gui/types';
import { cliThread } from '../../../shared/cli-gui/presentation';
import { completedTurnFiles } from '../../../shared/chat/turnPresentation';
import { timelineEntry } from './mapping';

const edit: ToolCallDetail = { type: 'edit', filePath: '/project/src/main.ts',
  oldString: 'old\r\n', newString: 'new\r\nextra\r\n' };
const tool = (detail: ToolCallDetail, status: ToolCallTimelineItem['status'] = 'completed'): ToolCallTimelineItem =>
  status === 'failed' ? { type: 'tool_call', callId: 'call', name: 'Edit', detail, status, error: 'failed' }
    : { type: 'tool_call', callId: 'call', name: 'Edit', detail, status, error: null };
function history(items: CliHistory['entries']): CliHistory {
  return { session: { id: 'cli', engine: 'claude', title: 'Task', cwd: '/project', model: 'test', status: 'idle',
    updatedAt: '2026-11-11', archived: false, permissions: [] }, entries: items, hasOlder: false };
}
const files = (entry: ToolCallTimelineItem) => completedTurnFiles(cliThread(history([
  timelineEntry(entry, 1, 2),
]))!.turns![0]);

it('preserves edit snippets through the wire without inventing file line numbers', () => {
  const entry = JSON.parse(JSON.stringify(timelineEntry(tool(edit), 1, 2)));
  const turn = cliThread(history([entry]))!.turns![0];
  expect(turn.items[0]).toMatchObject({ type: 'fileChange', status: 'completed' });
  const [file] = completedTurnFiles(turn);
  expect(file).toMatchObject({ path: '/project/src/main.ts', added: 2, removed: 1 });
  expect(file.lines.filter(line => line.kind === 'add').map(line => line.text)).toEqual(['new', 'extra']);
  expect(file.lines.every(line => line.oldLine === undefined && line.newLine === undefined)).toBe(true);
});

it('keeps native unified patches and their file line numbers', () => {
  const [file] = files(tool({ ...edit, unifiedDiff: '@@ -42 +42 @@\n-old\n+new\n' }));
  expect(file.lines[1]).toMatchObject({ oldLine: 42, text: 'old' });
  expect([file.added, file.removed]).toEqual([1, 1]);
});

it.each(['running', 'failed', 'canceled'] as const)('does not count %s edits as applied', status => {
  expect(files(tool(edit, status))).toEqual([]);
});

it('includes writes in file review without inventing the overwritten contents', () => {
  const [file] = files(tool({ type: 'write', filePath: '/project/README.md', content: 'replacement' }));
  expect(file).toMatchObject({ path: '/project/README.md', kind: 'update', raw: '', added: 0, removed: 0 });
});

it('keeps completed changes with their turn across history reloads and later messages', () => {
  const entries = [timelineEntry({ type: 'user_message', text: 'edit' }, 1, 1),
    timelineEntry(tool(edit), 2, 3), timelineEntry({ type: 'assistant_message', text: 'done' }, 4, 4),
    timelineEntry({ type: 'user_message', text: 'next' }, 5, 5)];
  const restored: CliHistory = JSON.parse(JSON.stringify(history(entries)));
  restored.session.status = 'running';
  const [first, second] = cliThread(restored)!.turns!;
  expect(first.status).toBe('completed'); expect(completedTurnFiles(first)).toHaveLength(1);
  expect(second.status).toBe('inProgress'); expect(completedTurnFiles(second)).toEqual([]);
});
