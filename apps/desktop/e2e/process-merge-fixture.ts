import type { Item, Thread } from '../../../shared/conversation/types';

export function processMergeSource(first: string): Thread {
  const head: Item[] = first === 'commandExecution' ? [] : [first === 'reasoning'
    ? { id: 'head', type: first, summary: ['正在检查项目。'] }
    : { id: 'head', type: 'agentMessage', phase: 'commentary', text: '正在检查项目。' }];
  return { id: 'chat', cwd: '', preview: '', updatedAt: 0, turns: [{ id: 'turn', status: 'completed', items: [
    { id: 'question', type: 'userMessage', content: [{ type: 'text', text: '请检查项目。' }] }, ...head,
    ...['one', 'two'].map(id => ({ id, type: 'commandExecution', status: 'completed', exitCode: 0,
      command: `echo ${id}`, aggregatedOutput: id })),
    { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '项目检查完成。' },
  ] }] };
}
