import type { ProjectDirectoriesResponse } from '../../../shared/remote-chat/projectDirectories';

export const LONG_PROJECT_NAME = '用于验证手机聊天顶部省略显示的项目名称'.repeat(4);
const ROOT = 'F:/projects';

export function demoProjectDirectories(input: Record<string, unknown>): ProjectDirectoriesResponse {
  const directory = String(input.directory ?? '');
  if (directory === 'D:/AgentHub') return { directory, parent: 'D:/', truncated: false,
    entries: [{ name: 'WorkData', path: 'D:/AgentHub/WorkData', directory: true }] };
  if (directory === '') return { directory, parent: null, entries: [{ name: 'F:', path: 'F:/' }], truncated: false };
  if (directory === 'F:/') return { directory, parent: '', entries: [{ name: 'projects', path: ROOT }], truncated: false };
  if (directory === ROOT) return { directory, parent: 'F:/', truncated: false, entries: [
    { name: LONG_PROJECT_NAME, path: `${ROOT}/${LONG_PROJECT_NAME}` },
    { name: '不可访问的文件夹', path: `${ROOT}/unavailable` },
  ] };
  if (directory === `${ROOT}/demo`) return { directory, parent: ROOT, entries: [], truncated: false };
  if (directory === `${ROOT}/${LONG_PROJECT_NAME}`) return { directory, parent: ROOT, entries: [], truncated: false };
  throw new Error('Fixture directory unavailable');
}
