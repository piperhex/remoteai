import type { PreviewProgress } from '../remote-chat/previewProgress';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const UNIT_BYTES = 1024;
function size(value: number) {
  const bytes = Number.isFinite(value) ? Math.max(0, value) : 0;
  const unit = Math.min(SIZE_UNITS.length - 1, Math.floor(Math.log(Math.max(1, bytes)) / Math.log(UNIT_BYTES)));
  const formatted = (bytes / UNIT_BYTES ** unit).toFixed(unit === 0 ? 0 : 1).replace(/\.0$/, '');
  return { value: formatted, unit: SIZE_UNITS[unit] };
}

function percentage(progress?: PreviewProgress) {
  if (progress?.total === undefined) return undefined;
  if (progress.total === 0) return 100;
  return Math.max(0, Math.min(100, Math.floor(progress.received / progress.total * 100)));
}

export function previewProgressText(progress?: PreviewProgress) {
  const received = size(progress?.received ?? 0);
  const total = progress?.total === undefined ? undefined : size(progress.total);
  const percent = percentage(progress);
  const downloaded = received.unit === total?.unit ? received.value : `${received.value} ${received.unit}`;
  const amount = `${downloaded} / ${total ? `${total.value} ${total.unit}` : '—'}`;
  const rate = progress?.bytesPerSecond === undefined ? undefined : size(progress.bytesPerSecond);
  return { percent, percentage: percent === undefined ? '—' : `${percent}%`, amount,
    speed: rate ? `${rate.value} ${rate.unit}/s` : '— /s' };
}
