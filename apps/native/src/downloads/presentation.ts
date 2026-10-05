import { t } from '../i18n';
import type { DownloadTask } from './types';

const KIB = 1024;
const MIB = KIB * KIB;
const GIB = MIB * KIB;
export function formatBytes(bytes: number) {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MB`;
  return `${Math.round(bytes / KIB)} KB`;
}
export function downloadPercent(task: DownloadTask) {
  if (task.status === 'completed') return 100;
  if (task.status === 'saving') return task.size ? Math.floor((task.savedBytes ?? 0) / task.size * 100) : 0;
  return task.size ? Math.min(100, Math.floor(task.received / task.size * 100)) : 0;
}
export const downloadStatus: Record<DownloadTask['status'], string> = {
  get preparing() { return t('准备并校验文件'); }, get verifying() { return t('正在校验'); },
  get saving() { return t('正在保存'); },
  get queued() { return t("等待下载"); }, get downloading() { return t("正在下载"); }, get paused() { return t("已暂停"); }, get completed() { return t("已完成"); }, get failed() { return t("下载中断"); },
};
export function downloadDetail(task: DownloadTask) {
  if (task.status === 'saving') return `${formatBytes(task.savedBytes ?? 0)} / ${formatBytes(task.size)}`;
  const speed = task.status === 'downloading' && task.bytesPerSecond
    ? ` · ${formatBytes(task.bytesPerSecond)}/s` : '';
  return `${formatBytes(task.received)} / ${formatBytes(task.size)}${speed}`;
}
