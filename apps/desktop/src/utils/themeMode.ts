import { applyThemeColor, DEFAULT_THEME_COLOR } from "../../../../shared/appearance/themeColor";

const THEME_MODE_KEY = "codex-switch:theme-mode";

export type ThemeMode = "light" | "dark";

export function loadThemeMode(): ThemeMode {
  return window.localStorage.getItem(THEME_MODE_KEY) === "dark" ? "dark" : "light";
}

export function applyThemeMode(mode: ThemeMode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  applyThemeColor(root.style.getPropertyValue("--green") || DEFAULT_THEME_COLOR);
}

export function persistThemeMode(mode: ThemeMode) {
  window.localStorage.setItem(THEME_MODE_KEY, mode);
}

export function isThemeModeStorageEvent(event: StorageEvent) {
  return event.key === THEME_MODE_KEY;
}
