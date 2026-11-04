import { conversation } from '../../../shared/conversation/events';
import { MODEL_CAPACITY_MESSAGE } from '../../../shared/conversation/requestError';
import type { Turn } from '../../../shared/conversation/types';

const error = { message: MODEL_CAPACITY_MESSAGE };
const turns: Turn[] = [
  { id: 'recovered', status: 'completed', items: [
    { id: 'before-question', type: 'userMessage',
      content: [{ type: 'text', text: '检查一下对话页的布局。' }] },
    { id: 'report', type: 'agentMessage', phase: 'final_answer',
      text: '已收紧消息间距，保留段落和代码的阅读空间。文件修改集中显示在下方，方便查看。\n\n'
        + '链接示例：[项目说明](https://github.com/TorbenXiong/remoteai)。' },
    { id: 'changed-file', type: 'fileChange', status: 'completed', changes: [
      { path: 'src/styles.module.less', kind: { type: 'update' },
        diff: '@@ -1,2 +1,2 @@\n-margin: 8px 0;\n-padding: 12px 0;\n+margin: 0;\n+padding: 6px 0;' },
    ] },
    { id: 'before-error', type: 'agentMessage', phase: 'commentary', text: '已编辑文件并检查布局。' },
  ], requestErrors: [
    { id: 'recovered:error', afterItemId: 'before-error', itemCount: 4, error, willRetry: true },
  ] },
  { id: 'failed', status: 'failed', error, items: [
    { id: 'repeat-question', type: 'userMessage',
      content: [{ type: 'text', text: '继续检查，看看连续出现提示时的效果。' }] },
    { id: 'attempt-one', type: 'agentMessage', phase: 'commentary', text: '正在检查输入区域。' },
    { id: 'attempt-two', type: 'agentMessage', phase: 'commentary', text: '再次尝试，继续检查。' },
    { id: 'attempt-three', type: 'agentMessage', phase: 'commentary', text: '正在重新请求。' },
  ], requestErrors: [
    { id: 'failed:error:1', afterItemId: 'attempt-one', itemCount: 2, error, willRetry: true },
    { id: 'failed:error:2', afterItemId: 'attempt-two', itemCount: 3, error, willRetry: true },
    { id: 'failed:error:3', afterItemId: 'attempt-three', itemCount: 4, error, willRetry: false },
  ] },
];

export const capacityConversation = conversation({ id: 'thread', cwd: '', preview: '', updatedAt: 1, turns });
export const singleCapacityConversation = conversation({
  id: 'thread', cwd: '', preview: '', updatedAt: 1, turns: turns.slice(0, 1),
});
