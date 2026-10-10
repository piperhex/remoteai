import { useSyncExternalStore } from 'react';
import { themeColor, type ThemeMode } from '../../../../shared/theme/mode';

let mode: ThemeMode = 'light';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getThemeMode = () => mode;
export const useThemeMode = () => useSyncExternalStore(subscribe, getThemeMode, getThemeMode);
const colors = { light: themeColor('light'), dark: themeColor('dark') };
export const useThemeColor = () => colors[useThemeMode()];

export function updateThemeMode(next: ThemeMode) {
  mode = next;
  listeners.forEach(listener => listener());
}
