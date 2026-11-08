import { expect, it } from 'vitest';
import { syncSourceLabel } from '../../../../shared/conversation/sync/sourceLabel';

it.each([
  'C:\\Users\\Codex\\AppData\\Roaming\\dev.codex.switch\\.codex',
  'C:/Users/demo/AppData/Roaming/DEV.CODEX.SWITCH/.codex',
  '/Users/demo/Library/Application Support/dev.codex.switch/.codex',
  '/home/demo/.local/share/dev.codex.switch/custom-home',
])('identifies a GUI source by path even when it has a custom home ID: %s', path => {
  const home = { id: 'custom', path, enabled: true };
  expect(syncSourceLabel('Office PC', home)).toBe('Office PC · CodexGUI');
  expect(home.path).toBe(path);
});

it('recognizes the built-in GUI home at a custom path', () => {
  expect(syncSourceLabel('Office PC', { id: 'codex-gui', path: 'D:/Remote AI/.codex', enabled: false }))
    .toBe('Office PC · CodexGUI');
});

it('preserves normal paths and computer names, including similar directory names', () => {
  const home = { id: 'default', path: 'C:/Users/demo/.codex', enabled: true };
  expect(syncSourceLabel('My PC', home)).toBe('My PC · C:/Users/demo/.codex');
  expect(syncSourceLabel('dev.codex.switch PC', home)).toBe('dev.codex.switch PC · C:/Users/demo/.codex');
  expect(syncSourceLabel('My PC', { ...home, path: 'D:/dev.codex-switch/.codex' }))
    .toBe('My PC · D:/dev.codex-switch/.codex');
});
