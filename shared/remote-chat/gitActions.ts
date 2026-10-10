import type { GitAction } from './gitTypes';

export const GIT_ACTIONS: { action: Exclude<GitAction, 'switch'>; label: string; hint: string }[] = [
  { action: 'fetch', label: '获取 Fetch', hint: '获取所有远程分支的最新记录，不修改本地文件。' },
  { action: 'pull', label: '拉取 Pull', hint: '拉取当前跟踪分支，并整合到当前分支。' },
  { action: 'update', label: '更新项目', hint: '获取远程更新，无冲突时自动合并并提交。' },
  { action: 'push', label: '推送 Push', hint: '将当前分支的提交推送到跟踪分支。' },
];
export const GIT_ACTION_NOTICE: Record<GitAction, string> = {
  switch: '已切换分支', fetch: '已获取远程记录', pull: '拉取完成', update: '项目已更新', push: '推送完成',
};
