import type { Thread } from '../../../shared/conversation/types';

export const detailText = 'const value = 2;\nexport default value;\n';
export function seedDemoDetails(thread: Thread) {
  thread.turns = [{ id: 'details', status: 'completed', items: [
    { id: 'detail-user', type: 'userMessage', text: '请查看代码和执行结果。' },
    { id: 'detail-command', type: 'commandExecution', command: 'npm test', exitCode: 0,
      aggregatedOutput: 'OUTPUT_START\n' + 'test output\n'.repeat(1500) + 'OUTPUT_END' },
    { id: 'detail-edit', type: 'fileChange', changes: [{ path: 'src/note.ts', kind: { type: 'update' },
      diff: '@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n' }] },
    { id: 'detail-answer', type: 'agentMessage', text: '已修改 [note.ts](src/note.ts:2)。\n\n'
      + '```typescript\n' + detailText + '```\n\n完整结果可在命令详情中查看。' },
  ] }];
}
