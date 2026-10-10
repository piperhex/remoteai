import { updateThemeMode } from './store';
export { useThemeMode, useThemeColor, getThemeMode } from './store';
import { Appearance, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import * as NavigationBar from 'expo-navigation-bar';
import { isThemeMode, themeColor, type ThemeMode } from '../../../../shared/theme/mode';

export const THEME_KEY = 'codex-switch.native.theme.v1';
let revision = 0;
let writes = Promise.resolve();
let systemWrites = Promise.resolve();

function applySystemBars(next: ThemeMode) {
  const background = themeColor(next)('#f7faf7', 'canvas');
  systemWrites = systemWrites.then(async () => {
    await SystemUI.setBackgroundColorAsync(background);
    if (Platform.OS !== 'android') return;
    await NavigationBar.setBackgroundColorAsync(background);
    await NavigationBar.setButtonStyleAsync(next === 'dark' ? 'light' : 'dark');
  }).catch(() => { /* The app remains usable if the OS manages its own system bar appearance. */ });
}

function applyTheme(next: ThemeMode) {
  updateThemeMode(next);
  Appearance.setColorScheme(next);
  applySystemBars(next);
}

export async function loadTheme(): Promise<void> {
  const current = revision;
  let saved: string | null = null;
  try { saved = await SecureStore.getItemAsync(THEME_KEY); }
  catch { /* A missing preference must not block startup. */ }
  if (current === revision) applyTheme(isThemeMode(saved) ? saved : 'light');
}

export function setThemeMode(next: ThemeMode): Promise<boolean> {
  if (!isThemeMode(next)) return Promise.resolve(false);
  revision++;
  applyTheme(next);
  // Serialize rapid selections so the last visible choice is also the persisted choice.
  const saved = writes.then(() => SecureStore.setItemAsync(THEME_KEY, next));
  writes = saved.catch(() => undefined);
  return saved.then(() => true, () => false);
}
