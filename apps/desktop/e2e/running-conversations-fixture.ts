import type { Thread } from '../../../shared/conversation/types';
import type { SidebarSnapshot } from '../../../shared/remote-chat/sidebar';

const titles = ['检查浏览器入口', '修复触屏导航返回', '整理共享组件', '验证对话同步', '更新项目文档',
  '检查深色主题与超长中文对话标题在窄窗口中的显示效果', '验证远程连接', '整理网页测试结果'];
export function runningFixtureThreads(): Thread[] {
  return titles.map((title, index) => ({ id: `running-${index}`, name: title, preview: title,
    cwd: index % 2 ? 'F:/projects/remoteai-web' : 'F:/projects/remoteai', updatedAt: 100 - index,
    status: { type: 'active' }, turns: [{ id: `turn-${index}`, status: 'inProgress', items: [] }] }));
}
export function runningFixtureSidebar(threads: Thread[], revision = 1): SidebarSnapshot {
  return { revision, readState: {}, threads: Object.fromEntries(threads.map(thread => [thread.id, {
    title: thread.name!, cwd: thread.cwd, projectName: thread.cwd.split('/').at(-1)!,
    running: thread.status?.type === 'active',
  }])) };
}
