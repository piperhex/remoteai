import type { ToolCallDetail } from '@getpaseo/protocol/agent-types';
import type { FileChange } from '../../../shared/conversation/types';

function fragment(text: string | undefined, prefix: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map(line => prefix + line);
}

/** CLI replacements often contain snippets, not file line numbers or a complete before image. */
export function fileChanges(detail: ToolCallDetail): FileChange[] | undefined {
  if (detail.type !== 'edit' && detail.type !== 'write') return undefined;
  if (!detail.filePath.trim()) return undefined;
  let diff = '';
  if (detail.type === 'edit') {
    diff = detail.unifiedDiff ?? '';
    if (!/^@@ /m.test(diff) && (detail.oldString !== undefined || detail.newString !== undefined)) {
      diff = ['@@ @@', ...fragment(detail.oldString, '-'), ...fragment(detail.newString, '+')].join('\n');
    }
  }
  // Write may overwrite an existing file. Without a before image, do not claim all content is newly added.
  return [{ path: detail.filePath, kind: { type: 'update' }, diff }];
}
