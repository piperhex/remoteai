import { useMemo, useSyncExternalStore } from "react";
import { normalizeThemeColor } from "../../../../../shared/appearance/themeColor";
import type { ThemeMode } from "../../utils/themeMode";

const STORAGE_KEY = "codex-switch:gui-theme";
const CHANGE_EVENT = "codex-switch:gui-theme-changed";
export type GuiTheme = { mode: ThemeMode | "inherit"; color: string | null };
export const DEFAULT_GUI_THEME: GuiTheme = { mode: "inherit", color: null };

function readSnapshot(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); }
  catch { return null; }
}

function parseTheme(saved: string | null): GuiTheme {
  try {
    const value: unknown = saved === null ? null : JSON.parse(saved);
    if (!value || typeof value !== "object") return DEFAULT_GUI_THEME;
    const { mode, color } = value as Record<string, unknown>;
    return {
      mode: mode === "light" || mode === "dark" ? mode : "inherit",
      color: typeof color === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)
        ? normalizeThemeColor(color) : null,
    };
  } catch { return DEFAULT_GUI_THEME; }
}

export function saveGuiTheme(patch: Partial<GuiTheme>): boolean {
  try {
    const next = parseTheme(JSON.stringify({ ...parseTheme(readSnapshot()), ...patch }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch { return false; }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useGuiTheme() {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => null);
  return useMemo(() => parseTheme(snapshot), [snapshot]);
}
