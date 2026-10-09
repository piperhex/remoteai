import type { DesktopInput, DesktopPlatform } from './protocol';

export const INPUT_TABS = [
  { id: 'ime', label: '输入法' }, { id: 'shortcuts', label: '快捷键' }, { id: 'keyboard', label: '电脑键盘' },
] as const;
export type InputTab = typeof INPUT_TABS[number]['id'];
export interface SoftKey { code: string; label: string; weight?: number }
export const MODIFIERS: SoftKey[] = [
  { code: 'ControlLeft', label: 'Ctrl' }, { code: 'ShiftLeft', label: 'Shift' },
  { code: 'AltLeft', label: 'Alt' }, { code: 'MetaLeft', label: 'Win' },
];
const letters = (row: string): SoftKey[] => [...row].map(label => ({ code: `Key${label}`, label }));
export const KEYBOARD_PAGES: SoftKey[][][] = [
  [
    [...'1234567890'].map(label => ({ code: `Digit${label}`, label })),
    letters('QWERTYUIOP'),
    [...letters('ASDFGHJKL'), { code: 'Backspace', label: '⌫' }],
    [...letters('ZXCVBNM'), { code: 'Space', label: 'Space', weight: 1.5 },
      { code: 'Enter', label: 'Enter', weight: 1.5 }],
  ],
  [
    Array.from({ length: 12 }, (_, index) => ({ code: `F${index + 1}`, label: `F${index + 1}` })),
    [{ code: 'Escape', label: 'Esc' }, { code: 'Tab', label: 'Tab' }, { code: 'CapsLock', label: 'Caps Lock' },
      { code: 'Insert', label: 'Insert' }, { code: 'Delete', label: 'Delete' }, { code: 'Backspace', label: '⌫' }],
    [{ code: 'Backquote', label: '`' }, { code: 'Minus', label: '-' }, { code: 'Equal', label: '=' },
      { code: 'BracketLeft', label: '[' }, { code: 'BracketRight', label: ']' }, { code: 'Backslash', label: '\\' },
      { code: 'Semicolon', label: ';' }, { code: 'Quote', label: "'" }, { code: 'Comma', label: ',' },
      { code: 'Period', label: '.' }, { code: 'Slash', label: '/' }],
    [{ code: 'Home', label: 'Home' }, { code: 'End', label: 'End' }, { code: 'PageUp', label: 'PgUp' },
      { code: 'PageDown', label: 'PgDn' }, { code: 'ArrowLeft', label: '←' }, { code: 'ArrowUp', label: '↑' },
      { code: 'ArrowDown', label: '↓' }, { code: 'ArrowRight', label: '→' }],
  ],
];
export const DESKTOP_SHORTCUTS = [
  { label: 'Caps Lock', description: '大小写锁定', codes: ['CapsLock'] },
  ...[['C', '复制'], ['V', '粘贴'], ['X', '剪切'], ['A', '全选'], ['Z', '撤销'], ['S', '保存']]
    .map(([key, description]) => ({ label: `Ctrl+${key}`, description, codes: ['ControlLeft', `Key${key}`] })),
  { label: 'Win', description: '开始', codes: ['MetaLeft'] },
  { label: 'Win+D', description: '显示桌面', codes: ['MetaLeft', 'KeyD'] },
  { label: 'Win+Tab', description: '切换窗口', codes: ['MetaLeft', 'Tab'] },
  { label: 'Win+L', description: '锁定屏幕', codes: ['MetaLeft', 'KeyL'] },
];

/** Complete every chord in one turn; tab changes and disconnects cannot leave a modifier held. */
export function sendDesktopChord(input: (event: DesktopInput) => void, codes: string[]) {
  const unique = [...new Set(codes)];
  for (const code of unique) input({ kind: 'keyboard', code, down: true });
  for (const code of unique.reverse()) input({ kind: 'keyboard', code, down: false });
}

const MAC_MODIFIERS = MODIFIERS.map(key => ({ ...key,
  label: key.code === 'MetaLeft' ? 'Cmd' : key.code === 'AltLeft' ? 'Option' : key.label }));
const MAC_SHORTCUTS = [
  DESKTOP_SHORTCUTS[0],
  ...[['C', '复制'], ['V', '粘贴'], ['X', '剪切'], ['A', '全选'], ['Z', '撤销'], ['S', '保存']]
    .map(([key, description]) => ({ label: `Cmd+${key}`, description, codes: ['MetaLeft', `Key${key}`] })),
  { label: 'Cmd+Space', description: '搜索', codes: ['MetaLeft', 'Space'] },
  { label: 'F11', description: '显示桌面', codes: ['F11'] },
  { label: 'Cmd+Tab', description: '切换窗口', codes: ['MetaLeft', 'Tab'] },
  { label: 'Ctrl+Cmd+Q', description: '锁定屏幕', codes: ['ControlLeft', 'MetaLeft', 'KeyQ'] },
];

export function desktopModifiers(platform?: DesktopPlatform) { return platform === 'macos' ? MAC_MODIFIERS : MODIFIERS; }
export function desktopShortcuts(platform?: DesktopPlatform) {
  return platform === 'macos' ? MAC_SHORTCUTS : DESKTOP_SHORTCUTS;
}
