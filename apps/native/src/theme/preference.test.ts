import { beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('expo-secure-store', () => ({ getItemAsync: storage.get, setItemAsync: storage.set }));
vi.mock('react-native', () => ({ Appearance: { setColorScheme: vi.fn() }, Platform: { OS: 'android' } }));
vi.mock('expo-system-ui', () => ({ setBackgroundColorAsync: () => Promise.resolve() }));
vi.mock('expo-navigation-bar', () => ({
  setBackgroundColorAsync: () => Promise.resolve(), setButtonStyleAsync: () => Promise.resolve(),
}));

beforeEach(() => { vi.resetModules(); storage.get.mockReset(); storage.set.mockReset(); });

it('restores a saved theme and tolerates invalid or unavailable storage', async () => {
  const { loadTheme, getThemeMode } = await import('./preference');
  storage.get.mockResolvedValue('dark');
  await loadTheme();
  expect(getThemeMode()).toBe('dark');
  storage.get.mockResolvedValue('invalid');
  await loadTheme();
  expect(getThemeMode()).toBe('light');
  storage.get.mockRejectedValue(new Error('Unavailable'));
  await expect(loadTheme()).resolves.toBeUndefined();
});

it('keeps a new choice when an earlier startup read finishes late', async () => {
  const { loadTheme, setThemeMode, getThemeMode } = await import('./preference');
  let finishRead: (value: string) => void = () => {};
  storage.get.mockImplementation(() => new Promise(resolve => { finishRead = resolve; }));
  const loading = loadTheme();
  await setThemeMode('dark');
  finishRead('light');
  await loading;
  expect(getThemeMode()).toBe('dark');
});

it('serializes rapid changes and reports a failed save without reverting the visible choice', async () => {
  const { setThemeMode, getThemeMode } = await import('./preference');
  let finishWrite: () => void = () => {};
  storage.set.mockImplementationOnce(() => new Promise<void>(resolve => { finishWrite = resolve; }));
  const first = setThemeMode('dark');
  const second = setThemeMode('light');
  await Promise.resolve();
  expect(storage.set).toHaveBeenCalledTimes(1);
  expect(getThemeMode()).toBe('light');
  finishWrite();
  await Promise.all([first, second]);
  expect(storage.set.mock.calls.map(call => call[1])).toEqual(['dark', 'light']);
  storage.set.mockRejectedValueOnce(new Error('Unavailable'));
  await expect(setThemeMode('dark')).resolves.toBe(false);
  expect(getThemeMode()).toBe('dark');
});
