import type { Item, Thread } from '../../../shared/conversation/types';
import type { ThreadGoal } from '../../../shared/conversation/goalTypes';
import { demoVideoResponse } from './demo-videos';
import previewImage from '../src-tauri/icons/32x32.png?inline';

const capacities = new Map<string, number | null>();
const goals = new Map<string, ThreadGoal>();

export function demoChatParityOperation(thread: Thread, input: Record<string, unknown>): { value: unknown } | undefined {
  const id = thread.id;
  if (input.operation === 'contextSettingsRead') return { value: { capacity: capacities.get(id) ?? null } };
  if (input.operation === 'contextSettingsWrite') {
    const settings = input.settings as { capacity: number | null };
    capacities.set(id, settings.capacity);
    return { value: { capacity: settings.capacity, update: 'applied' } };
  }
  if (input.operation === 'goalGet') return { value: { goal: goals.get(id) ?? null } };
  if (input.operation === 'goalClear') { goals.delete(id); return { value: {} }; }
  if (input.operation === 'goalSet') {
    const goal: ThreadGoal = { threadId: id, objective: String(input.objective ?? goals.get(id)?.objective ?? ''),
      status: input.status as ThreadGoal['status'], tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0,
      createdAt: Date.now(), updatedAt: Date.now() };
    goals.set(id, goal); return { value: { goal } };
  }
  if (input.operation === 'fileOpen') {
    const value = demoVideoResponse({ ...input, operation: 'videoOpen' });
    return { value: { ...value, name: 'test.mp4' } };
  }
  if (input.operation === 'fileRead' || input.operation === 'fileClose') {
    return { value: demoVideoResponse({ ...input, operation: String(input.operation).replace('file', 'video') }) };
  }
}

export function seedChatParity(thread: Thread) {
  thread.turns = [{ id: 'parity', status: 'completed', startedAt: 100, completedAt: 104,
    plan: [{ step: '检查聊天布局', status: 'completed' }, { step: '验证输入框', status: 'completed' }], items: [
      { id: 'parity-user', type: 'userMessage', text: '请检查聊天界面。' },
      { id: 'parity-reasoning', type: 'reasoning', summary: ['先检查布局，再验证交互。'], status: 'completed' },
      { id: 'parity-command', type: 'commandExecution', command: 'npm test', exitCode: 0, status: 'completed',
        aggregatedOutput: 'OUTPUT_START\n' + 'test output\n'.repeat(1500) + 'OUTPUT_END' },
      { id: 'parity-tools', type: 'mcpToolCall', tool: 'preview', status: 'completed', result: { content: [
        { type: 'text', text: '# 工具结果\n\n- 已确认布局\n\n| 项目 | 结果 |\n|---|---|\n| 输入 | 正常 |' },
        { type: 'image', data: previewImage.split(',')[1], mimeType: 'image/png' },
      ] } },
      { id: 'parity-edit', type: 'fileChange', status: 'completed', changes: [
        { path: 'src/chat/composer.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new\n' },
        { path: 'src/chat/messages.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new\n' },
        { path: 'tests/chat.test.ts', kind: { type: 'add' }, diff: '@@ -0,0 +1 @@\n+test\n' },
      ] },
      { id: 'parity-answer', type: 'agentMessage', phase: 'final_answer', text:
        '## 聊天界面测试\n\n1. 输入中文消息\n2. 检查流式回复\n\n| 场景 | 预期 |\n|---|---|\n| 中文 | 自动换行 |'
        + '\n\n```typescript\nconst ready: boolean = true;\n```\n\n'
        + '[查看文件](src/note.ts:2) · [播放视频](F:/projects/demo/test.mp4)' },
    ] }];
}

export function seedAsyncQuestion(thread: Thread, questions: NonNullable<Item['questions']> = [
  { title: '下一步验证什么？', options: ['输入框', '聊天记录'] },
  { title: '还有哪些细节？', options: null },
]) {
  thread.turns = [{ id: 'async-parity', status: 'completed', items: [
    { id: 'async-user', type: 'userMessage', text: '测试补充问题。' },
    { id: 'async-ask', type: 'agentMessage', phase: 'final_answer', delivery: 'async', text: '', questions },
  ] }];
}
