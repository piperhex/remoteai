// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as backend from "../../api/backend";
import type { DreamSkinCommunityTheme, DreamSkinMarketTheme, DreamSkinStatus } from "../../types";
import { useGuiSkin } from "./guiSkin";
import { useGuiSkinLibrary } from "./useGuiSkinLibrary";

vi.mock("../../api/backend", () => ({
  loadDreamSkinStatus: vi.fn(), loadDreamSkinThemePreview: vi.fn(), loadDreamSkinResourcesStatus: vi.fn(),
  installDreamSkinMarketTheme: vi.fn(), installDreamSkinCommunityTheme: vi.fn(), retryDreamSkinResources: vi.fn(),
  applyDreamSkinTheme: vi.fn(), installDreamSkin: vi.fn(), setDreamSkinOverlayOpacity: vi.fn(),
}));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
const status: DreamSkinStatus = { supported: true, platform: "windows", installed: false,
  runtimeInstalled: false, session: "notInstalled", activeThemeId: "shared",
  savedThemes: [{ id: "saved", name: "收藏" }] };
const catalog = { refreshMarket: vi.fn(), setCommunityThemes: vi.fn() };
let root: Root;
let library: ReturnType<typeof useGuiSkinLibrary>;
let settings: ReturnType<typeof useGuiSkin>;
function Fixture() { library = useGuiSkinLibrary(catalog); settings = useGuiSkin(); return null; }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  vi.mocked(backend.loadDreamSkinStatus).mockResolvedValue(status);
  vi.mocked(backend.loadDreamSkinResourcesStatus).mockResolvedValue({ phase: "ready", installed: true,
    downloadedBytes: 0 });
  vi.mocked(backend.loadDreamSkinThemePreview).mockResolvedValue("data:image/png;base64,skin");
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  localStorage.clear(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("selects built-in and saved images without installing or changing the shared skin", async () => {
  await act(async () => root.render(<Fixture />));
  expect(library.savedThemes).toEqual(status.savedThemes);
  for (const themeId of ["preset-rose-reverie", "saved"]) {
    await act(async () => library.actions.applyTheme(themeId));
    expect(settings.themeId).toBe(themeId);
    expect(settings.mode).toBe("custom");
    expect(library.error).toBeNull();
  }
  await act(async () => library.update({ overlayOpacity: 0.4 }));
  expect(settings.overlayOpacity).toBe(0.4);
  expect(backend.applyDreamSkinTheme).not.toHaveBeenCalled();
  expect(backend.installDreamSkin).not.toHaveBeenCalled();
  expect(backend.setDreamSkinOverlayOpacity).not.toHaveBeenCalled();
});

it("downloads community and market images before saving the independent choice", async () => {
  await act(async () => root.render(<Fixture />));
  const market = { id: "market", installed: false, updateAvailable: false } as DreamSkinMarketTheme;
  await act(async () => library.actions.installAndApplyMarketTheme(market));
  expect(backend.installDreamSkinMarketTheme).toHaveBeenCalledWith("market");
  expect(settings.themeId).toBe("market");
  const community = { id: "version", themeId: "community", installed: false,
    updateAvailable: false } as DreamSkinCommunityTheme;
  await act(async () => library.actions.installAndApplyCommunityTheme(community));
  expect(backend.installDreamSkinCommunityTheme).toHaveBeenCalledWith("version");
  expect(settings.themeId).toBe("community");
  expect(backend.applyDreamSkinTheme).not.toHaveBeenCalled();
  expect(backend.installDreamSkin).not.toHaveBeenCalled();
});

it("keeps the previous skin on missing images, failed downloads, or failed persistence", async () => {
  await act(async () => root.render(<Fixture />));
  await act(async () => library.actions.applyTheme("saved"));
  vi.mocked(backend.loadDreamSkinThemePreview).mockResolvedValueOnce(null);
  await act(async () => library.actions.applyTheme("missing"));
  expect(settings.themeId).toBe("saved");
  expect(library.error).toContain("无法读取");
  vi.mocked(backend.installDreamSkinMarketTheme).mockRejectedValueOnce(new Error("download failed"));
  await act(async () => library.actions.installAndApplyMarketTheme({ id: "broken" } as DreamSkinMarketTheme));
  expect(settings.themeId).toBe("saved");
  expect(library.error).toContain("加载失败");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  await act(async () => library.actions.applyTheme("unsaved"));
  expect(settings.themeId).toBe("saved");
  expect(library.error).toContain("未保存");
});

it("allows only one selection at a time and discards a selection after the dialog closes", async () => {
  let finish!: (image: string) => void;
  await act(async () => root.render(<Fixture />));
  vi.mocked(backend.loadDreamSkinThemePreview).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await act(async () => { library.actions.applyTheme("slow"); library.actions.applyTheme("overlap"); });
  expect(backend.loadDreamSkinThemePreview).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => finish("data:image/png;base64,late"));
  expect(localStorage.getItem("codex-switch:gui-skin")).toBeNull();
});

it("polls resource downloads without overlap and stops once ready", async () => {
  vi.useFakeTimers();
  let finish!: (value: Awaited<ReturnType<typeof backend.loadDreamSkinResourcesStatus>>) => void;
  vi.mocked(backend.loadDreamSkinResourcesStatus).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Fixture />));
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(backend.loadDreamSkinResourcesStatus).toHaveBeenCalledTimes(1);
  await act(async () => finish({ phase: "downloading", installed: false, downloadedBytes: 10 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(library.resources?.phase).toBe("ready");
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(backend.loadDreamSkinResourcesStatus).toHaveBeenCalledTimes(2);
});
