// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommunitySkillsMarket } from "./index";
import type { SkillMarketItem } from "../../../types";
import type { Translate } from "../../../i18n";

const backend = vi.hoisted(() => ({
  loadAppSettings: vi.fn(), fetchSkillMarket: vi.fn(), installMarketSkill: vi.fn(),
  removeMarketSkill: vi.fn(), setMarketSkillEnabled: vi.fn(), skillPreviewUrl: vi.fn(() => null),
}));
vi.mock("../../../api/backend", () => ({ ...backend, hasLocalBackend: true, isDesktopApp: false }));
vi.mock('../../../../../../shared/platform/localBackend', async () => await import('../../../api/backend'));

let root: Root;
let container: HTMLDivElement;
const skill = (title: string, installed = false): SkillMarketItem => ({
  id: title, title, description: "Demo", version: "1.0.0", archiveSize: 100, archiveSha256: "demo",
  hasPreview: false, uploaderId: null, official: false, installCount: 0, createdAt: "", updatedAt: "",
  installed, enabled: installed, installedVersion: installed ? "1.0.0" : null,
});
const t: Translate = (key) => key;

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  backend.loadAppSettings.mockResolvedValue({ codexHomes: [
    { id: "default", path: "C:/codex", enabled: true },
    { id: "codex-gui", path: "C:/gui/.codex", enabled: false },
  ] });
  backend.fetchSkillMarket.mockImplementation(async (home: string) => [skill(home)]);
  backend.installMarketSkill.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.innerHTML = '<div id="skills-market-topbar-actions"></div><div id="skills-market-tabs"></div>';
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

async function render() {
  await act(async () => root.render(<CommunitySkillsMarket active activeTab="community" authenticated
    onTabChange={vi.fn()} onLogin={vi.fn()} notify={vi.fn()} t={t} />));
}

async function chooseGui() {
  const input = container.querySelector<HTMLInputElement>("input[role=combobox]")!;
  await act(async () => input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")]
    .find((item) => item.textContent?.includes("内置 Codex GUI"))!;
  await act(async () => option.click());
}

it("places the home selector above the grid and loads the selected home's installation state", async () => {
  await render();
  const selector = container.querySelector(".ant-select")!;
  const grid = container.querySelector(".skills-market-grid")!;
  expect(selector.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.getElementById("skills-market-topbar-actions")!.querySelector(".ant-select")).toBeNull();
  expect(backend.fetchSkillMarket).toHaveBeenCalledWith("default");
  await chooseGui();
  expect(backend.fetchSkillMarket).toHaveBeenCalledWith("codex-gui");
  expect(container.querySelector(".skill-card h3")!.textContent).toBe("codex-gui");
});

it("ignores a previous home's late response and installs only in the selected home", async () => {
  let finish!: (items: SkillMarketItem[]) => void;
  backend.fetchSkillMarket.mockImplementation((home: string) => home === "default"
    ? new Promise<SkillMarketItem[]>((resolve) => { finish = resolve; })
    : Promise.resolve([skill("gui-plugin")]));
  await render();
  await chooseGui();
  await act(async () => finish([skill("old-home-plugin")]));
  expect(container.textContent).toContain("gui-plugin");
  expect(container.textContent).not.toContain("old-home-plugin");
  await act(async () => container.querySelector<HTMLButtonElement>(".skill-install-button")!.click());
  expect(backend.installMarketSkill).toHaveBeenCalledWith(skill("gui-plugin"), "codex-gui");
});

it("blocks home switching and repeated actions until installation and refresh finish", async () => {
  let finish!: () => void;
  backend.installMarketSkill.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render();
  const button = container.querySelector<HTMLButtonElement>(".skill-install-button")!;
  await act(async () => { button.click(); button.click(); });
  expect(backend.installMarketSkill).toHaveBeenCalledTimes(1);
  expect(container.querySelector<HTMLInputElement>("input[role=combobox]")!.disabled).toBe(true);
  await act(async () => finish());
  expect(container.querySelector<HTMLInputElement>("input[role=combobox]")!.disabled).toBe(false);
});

it("uses the selected home for toggling and uninstalling", async () => {
  backend.fetchSkillMarket.mockResolvedValue([skill("installed", true)]);
  await render();
  await chooseGui();
  await act(async () => container.querySelector<HTMLButtonElement>("button[role=switch]")!.click());
  expect(backend.setMarketSkillEnabled).toHaveBeenCalledWith("installed", false, "codex-gui");
  await act(async () => container.querySelector<HTMLButtonElement>(".uninstall")!.click());
  const confirm = document.querySelector<HTMLButtonElement>(".ant-popconfirm .ant-btn-primary")!;
  await act(async () => confirm.click());
  expect(backend.removeMarketSkill).toHaveBeenCalledWith("installed", "codex-gui");
});
