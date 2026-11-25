import type { DreamSkinImportOptions } from "../../types";

export function isRestartRequired(error: unknown): boolean {
  return (error instanceof Error ? error.message : error) === "DREAM_SKIN_RESTART_REQUIRED";
}

export const APPEARANCE_OPTIONS = [
  { value: "auto", labelKey: "dreamSkin.option.auto" },
  { value: "light", labelKey: "dreamSkin.option.light" },
  { value: "dark", labelKey: "dreamSkin.option.dark" },
] as const;

export const SAFE_AREA_OPTIONS = [
  { value: "auto", labelKey: "dreamSkin.option.auto" },
  { value: "left", labelKey: "dreamSkin.option.left" },
  { value: "right", labelKey: "dreamSkin.option.right" },
  { value: "center", labelKey: "dreamSkin.option.center" },
  { value: "none", labelKey: "dreamSkin.option.none" },
] as const;

export const TASK_MODE_OPTIONS = [
  { value: "auto", labelKey: "dreamSkin.option.auto" },
  { value: "ambient", labelKey: "dreamSkin.option.ambient" },
  { value: "banner", labelKey: "dreamSkin.option.banner" },
  { value: "off", labelKey: "dreamSkin.option.off" },
] as const;

export const COMMUNITY_PAGE_SIZE = 48;
export const COMMUNITY_CATALOG_LIMIT = 500;

export const DEFAULT_IMPORT_OPTIONS: DreamSkinImportOptions = {
  name: "My Dream Skin",
  appearance: "auto",
  safeArea: "auto",
  taskMode: "auto",
  focusX: null,
  focusY: null,
};
