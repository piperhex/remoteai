import { conversation } from '../../../shared/conversation/events';
import { MODEL_CAPACITY_MESSAGE } from '../../../shared/conversation/requestError';
import type { Item, Turn } from '../../../shared/conversation/types';

function question(id: string, text: string): Item {
  return { id, type: 'userMessage', content: [{ type: 'text', text }] };
}

function reply(id: string, text: string): Item {
  return { id, type: 'agentMessage', text, phase: 'final_answer' };
}

const turns: Turn[] = [
  { id: 'inspect', status: 'completed', durationMs: 18_000, items: [
    question('inspect-question', '先帮我看看这个项目的结构，主要页面在哪里？'),
    { id: 'inspect-command', type: 'commandExecution', command: 'rg --files apps/desktop/src/pages',
      status: 'completed', exitCode: 0,
      aggregatedOutput: 'codexGui/Messages.tsx\ncodexGui/Composer.tsx\ncodexGui/ProjectPicker.tsx' },
    reply('inspect-answer', '桌面端页面集中在 `apps/desktop/src/pages`。\n\n'
      + '| 页面 | 作用 |\n| --- | --- |\n| Codex | 对话、项目选择和消息输入 |\n'
      + '| 会话管理 | 查找和整理历史对话 |\n| 设置 | 调整外观与常用选项 |\n\n'
      + '这次可以先从对话页入手，查看消息之间的留白和输入框附近的布局。'),
  ] },
  { id: 'layout', status: 'completed', durationMs: 32_000, items: [
    question('layout-question', '对话里的留白有点多。请收紧消息间距，但长回复和代码仍然要好读。'),
    { id: 'layout-progress', type: 'agentMessage', phase: 'commentary',
      text: '我会缩小每轮对话的间距，同时保留段落、列表和代码块的层次。' },
    { id: 'layout-files', type: 'fileChange', status: 'completed', changes: [
      { path: 'apps/desktop/src/pages/codexGui/styles.module.less', kind: { type: 'update' },
        diff: '@@ -1,2 +1,2 @@\n-gap: 24px;\n-padding: 20px;\n+gap: 14px;\n+padding: 12px;' },
      { path: 'apps/desktop/src/pages/codexGui/EditedFilesSummary.module.less', kind: { type: 'update' },
        diff: '@@ -1 +1 @@\n-padding: 12px 16px;\n+padding: 8px 12px;' },
    ] },
    reply('layout-answer', '已收紧消息和文件列表的间距。长回复仍保留段落分隔，代码块也可以独立阅读。\n\n'
      + '例如，输入内容会先去掉首尾空格，再判断是否可以发送：\n\n'
      + '```typescript\nfunction canSend(message: string) {\n  return message.trim().length > 0;\n}\n```\n\n'
      + '你可以对照这一轮的长消息与下一轮的短消息，看看密度是否合适。'),
  ] },
  { id: 'short', status: 'completed', items: [
    question('short-question', '短消息看起来怎么样？'),
    reply('short-answer', '像这一条，保持自然的上下间距即可。'),
  ] },
  { id: 'project', status: 'completed', durationMs: 21_000, items: [
    question('project-question', '新对话能直接拖入一个文件夹作为项目吗？项目名称也想自己改。'),
    reply('project-answer', '可以。新对话中把文件夹拖到输入区域，松开后即可选中项目。\n\n'
      + '也可以点击「选择项目」→「新建项目」，在弹窗里拖入文件夹，再填写项目名称。\n\n'
      + '> 这个预览页用于检查布局；从资源管理器拖入文件夹需要在桌面程序中体验。'),
  ] },
  { id: 'review', status: 'completed', items: [
    question('review-question', '验收时我应该重点看哪些地方？'),
    reply('review-answer', '可以重点看这几处：\n\n'
      + '- 多轮对话之间是否紧凑，用户提问与回复是否容易区分。\n'
      + '- 长段落、表格和代码块是否清晰。\n'
      + '- 文件修改列表展开后是否好读。\n'
      + '- 下方错误提示与重试按钮是否协调。'),
  ] },
  { id: 'failed', status: 'failed', error: { message: MODEL_CAPACITY_MESSAGE }, items: [
    question('question', '再检查一下窄窗口里的显示效果。'),
    { id: 'progress', type: 'agentMessage', text: '正在检查窄窗口中的文字换行和按钮位置。', phase: 'commentary' },
  ] },
];

export const previewConversation = conversation({ id: 'thread', cwd: '', preview: '', updatedAt: 1, turns });
