import { useSyncExternalStore } from 'react';
import { darkColors, isThemeMode, type ThemeMode } from '../../../../shared/theme/mode';

export const THEME_KEY = 'codex-switch.web.theme.v1';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let mode: ThemeMode = 'light';
export const getThemeMode = () => mode;
export const useThemeMode = () => useSyncExternalStore(subscribe, getThemeMode, getThemeMode);

function applyTheme(next: ThemeMode) {
  mode = next;
  const root = document.documentElement;
  root.dataset.theme = next;
  root.dataset.prefersColorScheme = next;
  root.style.colorScheme = next;
  for (const [role, color] of Object.entries(darkColors)) {
    if (next === 'dark') root.style.setProperty(`--app-${role}`, color);
    else root.style.removeProperty(`--app-${role}`);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
    next === 'dark' ? darkColors.canvas : '#f4f7f5');
  listeners.forEach(listener => listener());
}

export function initializeTheme() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(THEME_KEY); }
  catch { /* Storage can be unavailable in a private browser session. */ }
  applyTheme(isThemeMode(saved) ? saved : 'light');
}

export function setThemeMode(next: ThemeMode): boolean {
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); return true; }
  catch { return false; }
}

window.addEventListener('storage', event => {
  if (event.key === THEME_KEY) applyTheme(isThemeMode(event.newValue) ? event.newValue : 'light');
});
