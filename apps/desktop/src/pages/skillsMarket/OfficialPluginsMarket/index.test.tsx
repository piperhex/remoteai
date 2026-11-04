// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OfficialPluginsMarket } from "./index";
import type { OfficialPluginItem } from "../../../types";
import type { Translate } from "../../../i18n";

const backend = vi.hoisted(() => ({
  loadAppSettings: vi.fn(), fetchOfficialPlugins: vi.fn(), installOfficialPlugin: vi.fn(),
  removeOfficialPlugin: vi.fn(), setOfficialPluginEnabled: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("../../../api/backend", () => ({ ...backend, hasLocalBackend: true, isDesktopApp: false }));
vi.mock('../../../../../../shared/platform/localBackend', async () => await import('../../../api/backend'));

let root: Root;
let container: HTMLDivElement;
const plugin = (name: string, installed = false): OfficialPluginItem => ({
  id: `${name}@openai-curated`, name, title: name, description: "Demo", version: "1.0.0",
  category: "Tools", developer: "OpenAI", brandColor: null, iconUrl: null, installed, enabled: installed,
});
const t: Translate = (key) => key;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  backend.loadAppSettings.mockResolvedValue({ codexHomes: [
    { id: "default", path: "C:/codex", enabled: true },
    { id: "codex-gui", path: "C:/gui/.codex", enabled: false },
  ] });
  backend.invoke.mockImplementation(async (command: string) => {
    if (command === "codex_gui_cli_status") return { version: "0.153.4" };
    return { version: "0.153.4", size: 1024 };
  });
  backend.fetchOfficialPlugins.mockImplementation(async (home: string) => [plugin(home)]);
  backend.installOfficialPlugin.mockResolvedValue(undefined);
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
  await act(async () => root.render(<OfficialPluginsMarket active activeTab="official"
    onTabChange={vi.fn()} notify={vi.fn()} t={t} />));
}

async function chooseGui() {
  const input = document.querySelector<HTMLInputElement>("input[role=combobox]")!;
  await act(async () => input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")]
    .find((item) => item.textContent?.includes("内置 Codex GUI"))!;
  await act(async () => option.click());
}

it("offers installation before search and loads the selected home after installing", async () => {
  backend.invoke.mockImplementation(async (command: string) => ({
    version: command === "codex_gui_cli_status" ? null : "0.153.4", size: 1024,
  }));
  await render();
  expect(backend.fetchOfficialPlugins).not.toHaveBeenCalled();
  const actions = document.getElementById("skills-market-topbar-actions")!;
  expect(actions.querySelector(".ant-select")).toBeNull();
  expect(container.querySelector(".skills-market-page > div .ant-select")).not.toBeNull();
  const install = actions.querySelector<HTMLButtonElement>("button")!;
  expect(install.textContent).toContain("安装 Codex");
  expect(install.compareDocumentPosition(actions.querySelector("input")!) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
  await act(async () => install.click());
  expect(backend.invoke).toHaveBeenCalledWith("codex_gui_cli_install", { version: "0.153.4" });
  expect(backend.fetchOfficialPlugins).toHaveBeenCalledWith("default");
  expect(actions.textContent).not.toContain("安装 Codex");
});

it("ignores a previous home's late catalog and installs only in the selected home", async () => {
  let finish!: (items: OfficialPluginItem[]) => void;
  backend.fetchOfficialPlugins.mockImplementation((home: string) => home === "default"
    ? new Promise<OfficialPluginItem[]>((resolve) => { finish = resolve; })
    : Promise.resolve([plugin("gui-plugin")]));
  await render();
  await chooseGui();
  await act(async () => finish([plugin("old-home-plugin")]));
  expect(container.textContent).toContain("gui-plugin");
  expect(container.textContent).not.toContain("old-home-plugin");
  await act(async () => container.querySelector<HTMLButtonElement>(".skill-install-button")!.click());
  expect(backend.installOfficialPlugin).toHaveBeenCalledWith("gui-plugin@openai-curated", "codex-gui");
});

it("blocks repeated changes while an installation is in progress", async () => {
  let finish!: () => void;
  backend.installOfficialPlugin.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render();
  const button = container.querySelector<HTMLButtonElement>(".skill-install-button")!;
  await act(async () => { button.click(); button.click(); });
  expect(backend.installOfficialPlugin).toHaveBeenCalledTimes(1);
  expect(document.querySelector<HTMLInputElement>("input[role=combobox]")!.disabled).toBe(true);
  await act(async () => finish());
});

it("uses the selected home for both toggling and uninstalling", async () => {
  backend.fetchOfficialPlugins.mockResolvedValue([plugin("installed", true)]);
  await render();
  await chooseGui();
  await act(async () => container.querySelector<HTMLButtonElement>(".official-plugin-toggle")!.click());
  expect(backend.setOfficialPluginEnabled).toHaveBeenCalledWith("installed@openai-curated", false, "codex-gui");
  await act(async () => container.querySelector<HTMLButtonElement>(".uninstall")!.click());
  expect(backend.removeOfficialPlugin).toHaveBeenCalledWith("installed@openai-curated", "codex-gui");
});
