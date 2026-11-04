// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadAppSettings, subscribeToThemeColorChanges } from "../../api/backend";
import { useThemeColor } from "../../hooks/useThemeColor";
import { useThemeMode } from "../../hooks/useThemeMode";
import { DEFAULT_THEME_COLOR } from "../../../../../shared/appearance/themeColor";
import { loadThemeMode, persistThemeMode } from "../../utils/themeMode";
import { DEFAULT_GUI_THEME, saveGuiTheme, useGuiTheme } from "./guiTheme";

vi.mock("../../api/backend", () => ({
  loadAppSettings: vi.fn(), subscribeToThemeColorChanges: vi.fn(), updateThemeColor: vi.fn(),
}));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
const notify = vi.fn();
let root: Root;
let current: ReturnType<typeof useGuiTheme>;
let appMode: ReturnType<typeof useThemeMode>;

function Fixture({ active = true }: { active?: boolean }) {
  current = useGuiTheme();
  useThemeColor(notify, active ? current.color ?? undefined : undefined);
  appMode = useThemeMode(active && current.mode !== "inherit" ? current.mode : undefined);
  return null;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadAppSettings).mockResolvedValue({ themeColor: DEFAULT_THEME_COLOR } as
    Awaited<ReturnType<typeof loadAppSettings>>);
  vi.mocked(subscribeToThemeColorChanges).mockReturnValue(() => {});
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("applies GUI preferences immediately and restores the application theme on exit", async () => {
  await act(async () => root.render(<Fixture />));
  expect(current).toEqual(DEFAULT_GUI_THEME);
  await act(async () => { expect(saveGuiTheme({ mode: "dark", color: "#7861d9" })).toBe(true); });
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.getPropertyValue("--green")).toBe("#7861d9");
  expect(loadThemeMode()).toBe("light");
  await act(async () => root.render(<Fixture active={false} />));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.style.getPropertyValue("--green")).toBe(DEFAULT_THEME_COLOR);
  await act(async () => root.unmount());
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Fixture />));
  expect(current).toEqual({ mode: "dark", color: "#7861d9" });
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("follows application changes only when the corresponding preference is inherited", async () => {
  persistThemeMode("dark");
  saveGuiTheme({ mode: "light", color: "#D85" });
  await act(async () => root.render(<Fixture />));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.style.getPropertyValue("--green")).toBe("#dd8855");
  const publishColor = vi.mocked(subscribeToThemeColorChanges).mock.calls.at(-1)![0];
  await act(async () => publishColor("#aabbcc"));
  expect(document.documentElement.style.getPropertyValue("--green")).toBe("#dd8855");
  await act(async () => { saveGuiTheme(DEFAULT_GUI_THEME); });
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.getPropertyValue("--green")).toBe("#aabbcc");
  await act(async () => appMode.setMode("light"));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(current).toEqual(DEFAULT_GUI_THEME);
});

it("keeps a slow application settings response from replacing the GUI color", async () => {
  let resolve!: (settings: Awaited<ReturnType<typeof loadAppSettings>>) => void;
  vi.mocked(loadAppSettings).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  saveGuiTheme({ color: "#123456" });
  await act(async () => root.render(<Fixture />));
  await act(async () => resolve({ themeColor: "#abcdef" } as Awaited<ReturnType<typeof loadAppSettings>>));
  expect(document.documentElement.style.getPropertyValue("--green")).toBe("#123456");
  await act(async () => root.render(<Fixture active={false} />));
  expect(document.documentElement.style.getPropertyValue("--green")).toBe("#abcdef");
});

it("synchronizes other windows and recovers from invalid or cleared settings", async () => {
  await act(async () => root.render(<Fixture />));
  for (const saved of ['{"mode":"dark","color":"#abc"}', '{"mode":"invalid","color":42}', 'null', '{']) {
    await act(async () => {
      localStorage.setItem("codex-switch:gui-theme", saved);
      window.dispatchEvent(new StorageEvent("storage", { key: "codex-switch:gui-theme" }));
    });
    expect(current).toEqual(saved.includes('"dark"') ? { mode: "dark", color: "#aabbcc" } : DEFAULT_GUI_THEME);
  }
  await act(async () => { saveGuiTheme({ mode: "dark" }); });
  await act(async () => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(current).toEqual(DEFAULT_GUI_THEME);
});

it("retains the applied preference when saving fails", async () => {
  await act(async () => root.render(<Fixture />));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
  await act(async () => { expect(saveGuiTheme({ mode: "dark" })).toBe(false); });
  expect(current).toEqual(DEFAULT_GUI_THEME);
  expect(document.documentElement.dataset.theme).toBe("light");
});
