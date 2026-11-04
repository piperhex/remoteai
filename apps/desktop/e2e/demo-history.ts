import type { Thread } from '../../../shared/conversation/types';

export function seedDemoHistory(thread: Thread) {
  thread.turns = [{ id: 'history', status: 'completed', items: Array.from({ length: 35 }, (_, index) => ({
    id: `history-${index + 1}`, type: index % 2 ? 'agentMessage' : 'userMessage', phase: 'final_answer',
    text: `历史消息 ${index + 1}\n\n这是一条用于验证分页和阅读位置的聊天记录。`,
  })) }];
}

export function seedDemoCompactHistory(thread: Thread) {
  thread.turns = [{ id: 'compact-history', status: 'completed', items: [
    ...Array.from({ length: 25 }, (_, index) => ({
      id: `compact-${index}`, type: 'userMessage', text: `更早的消息 ${index + 1}`,
    })),
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `compact-tool-${index}`, type: 'commandExecution', command: 'echo test', status: 'completed',
    })),
    { id: 'compact-answer', type: 'agentMessage', text: '处理完成，可以继续查看更早的消息。' },
  ] }];
}

export function seedDemoOpeningHistory(thread: Thread) {
  const paragraph = '这段较长的回复用于验证打开聊天时的阅读位置，内容应完整显示，不能只留下底部按钮。';
  thread.turns = [{ id: 'opening-history', status: 'completed',
    diff: 'diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+after',
    items: Array.from({ length: 35 }, (_, index) => ({
      id: `opening-${index + 1}`, type: index % 2 || index === 34 ? 'agentMessage' : 'userMessage',
      text: `打开记录 ${index + 1}\n\n${Array.from({ length: index === 34 ? 160 : (index % 6) + 1 },
        (_, line) => `${line + 1}. ${paragraph}`).join('\n\n')}\n\n记录末尾 ${index + 1}`,
    })) }];
}

export function seedDemoFooterHistory(thread: Thread) {
  thread.turns = [{ id: 'footer-history', status: 'completed',
    items: [{ id: 'footer-reply', type: 'agentMessage', text: '这条回复后有较长的错误详情。' }],
    error: { message: `${Array.from({ length: 60 }, (_, index) =>
      `错误详情 ${index + 1}：这段内容用于验证较长的提示不会挡住聊天记录。`).join('\n')}\n错误详情结束` },
  }];
}
