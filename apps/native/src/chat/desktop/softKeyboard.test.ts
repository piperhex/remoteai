import { expect, it, vi } from 'vitest';
import { desktopKeyCode } from '../../../../../shared/remote-desktop/keyboard';
import { DESKTOP_SHORTCUTS, KEYBOARD_PAGES, MODIFIERS, sendDesktopChord, desktopShortcuts, desktopModifiers }
  from '../../../../../shared/remote-desktop/softKeyboard';
import { parseDesktopImeMessage } from '../../../../../shared/remote-desktop/ime';

it('sends a chord in order and releases every key in reverse order', () => {
  const input = vi.fn();
  sendDesktopChord(input, ['ControlLeft', 'ShiftLeft', 'KeyZ']);
  expect(input.mock.calls.map(([event]) => event)).toEqual([
    { kind: 'keyboard', code: 'ControlLeft', down: true },
    { kind: 'keyboard', code: 'ShiftLeft', down: true },
    { kind: 'keyboard', code: 'KeyZ', down: true },
    { kind: 'keyboard', code: 'KeyZ', down: false },
    { kind: 'keyboard', code: 'ShiftLeft', down: false },
    { kind: 'keyboard', code: 'ControlLeft', down: false },
  ]);
});

it('only offers keys that the remote keyboard protocol supports', () => {
  const codes = [...KEYBOARD_PAGES.flat(2), ...MODIFIERS].map(key => key.code);
  codes.push(...DESKTOP_SHORTCUTS.flatMap(shortcut => shortcut.codes));
  expect(codes.every(desktopKeyCode)).toBe(true);
});

it('limits the native IME bridge to committed text and supported editing keys', () => {
  expect(parseDesktopImeMessage('{"kind":"text","text":"你好"}')).toEqual({ kind: 'text', text: '你好' });
  expect(parseDesktopImeMessage('{"kind":"key","key":"backspace"}'))
    .toEqual({ kind: 'key', key: 'backspace' });
  for (const invalid of ['null', '{', '{"kind":"text","text":42}', '{"kind":"key","key":"desktop"}',
    JSON.stringify({ kind: 'text', text: 'a'.repeat(1001) })]) expect(parseDesktopImeMessage(invalid)).toBeUndefined();
});

it('uses Mac shortcuts and modifier labels only for a Mac host', () => {
  expect(desktopShortcuts()).toBe(DESKTOP_SHORTCUTS);
  expect(desktopModifiers('windows')).toBe(MODIFIERS);
  expect(desktopModifiers('macos').map(key => key.label)).toEqual(['Ctrl', 'Shift', 'Option', 'Cmd']);
  const shortcuts = desktopShortcuts('macos');
  expect(shortcuts.find(item => item.description === '复制')?.codes).toEqual(['MetaLeft', 'KeyC']);
  expect(shortcuts.find(item => item.description === '锁定屏幕')?.codes)
    .toEqual(['ControlLeft', 'MetaLeft', 'KeyQ']);
  expect(shortcuts.flatMap(item => item.codes).every(desktopKeyCode)).toBe(true);
});
