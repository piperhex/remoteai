import type { DesktopDisplay, DesktopResolution, DesktopSettings } from './protocol';

export interface DisplaySettingsProps {
  resolution?: { options: DesktopResolution[]; change: (size: DesktopResolution) => Promise<void> };
  displays: DesktopDisplay[];
  settings: DesktopSettings;
  update: (settings: DesktopSettings) => Promise<void>;
  saving: boolean;
  close: () => void;
  stats: { visible: boolean; toggle: () => void };
}

export const FRAME_RATE_OPTIONS = ['auto', 30, 60, 90, 144] as const;
export const QUALITY_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'smooth', label: '流畅' },
  { value: 'clear', label: '高清' },
  { value: 'original', label: '超清' },
] as const;

export const MOUSE_INSTRUCTIONS = [
  '在鼠标面板外，双指张合缩放画面，双指滑动平移画面。',
  '滑动画面或鼠标下半部可移动指针，轻点即可单击。',
  '按住左键滑动可拖拽，松手结束；长按不动可锁定拖拽，再点左键结束。',
  '按住中央箭头并拖动可滚动，松手返回鼠标面板。',
  '拖动横线把手可移动鼠标面板。',
] as const;
