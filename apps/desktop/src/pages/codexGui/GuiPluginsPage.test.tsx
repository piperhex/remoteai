// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GuiPluginsPage from "./GuiPluginsPage";
import type { Translate } from "../../i18n";
import { GUI_CODEX_HOME_ID, type OfficialPluginItem, type SkillMarketItem } from "../../types";

const backend = vi.hoisted(() => ({
  loadAppSettings: vi.fn(), fetchSkillMarket: vi.fn(), installMarketSkill: vi.fn(),
  removeMarketSkill: vi.fn(), setMarketSkillEnabled: vi.fn(), skillPreviewUrl: vi.fn(() => null),
  fetchOfficialPlugins: vi.fn(), installOfficialPlugin: vi.fn(), removeOfficialPlugin: vi.fn(),
  setOfficialPluginEnabled: vi.fn(), fetchPromptPlugins: vi.fn(), invoke: vi.fn(),
}));
vi.mock("../../api/backend", () => ({ ...backend, hasLocalBackend: true, isDesktopApp: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock("../../../../../shared/conversation/webEvents", () => ({ subscribeGuiEvent: vi.fn(async () => () => undefined) }));

let root: Root;
let container: HTMLDivElement;
const t: Translate = (key) => key;
const community: SkillMarketItem = {
  id: "community-plugin", title: "Community plugin", description: "A small community plugin", version: "1.0.0",
  archiveSize: 100, archiveSha256: "demo", hasPreview: false, uploaderId: null, official: false,
  installCount: 0, createdAt: "", updatedAt: "", installed: false, enabled: false, installedVersion: null,
};
const official: OfficialPluginItem = {
  id: "official@openai-curated", name: "official", title: "Official plugin", description: "An official plugin",
  version: "1.0.0", category: "Tools", developer: "OpenAI", brandColor: null, iconUrl: null,
  installed: false, enabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  backend.fetchSkillMarket.mockResolvedValue([community]);
  backend.fetchOfficialPlugins.mockResolvedValue([official]);
  backend.fetchPromptPlugins.mockResolvedValue([]);
  backend.invoke.mockImplementation(async (command: string) => {
    if (command === "codex_gui_cli_status") return { version: "0.153.4" };
    return { supported: true, installed: false, enabled: false, version: "1.0.0" };
  });
  document.body.innerHTML = '<div id="skills-market-topbar-actions"></div><div id="skills-market-tabs"></div>';
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => root.render(<GuiPluginsPage active authenticated t={t}
    onLogin={vi.fn()} notify={vi.fn()} homeId="default" />));
}

async function selectTab(tab: "community" | "official" | "prompt") {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((item) => item.textContent === `skills.tabs.${tab}`)!;
  await act(async () => button.click());
}

function card(title: string) {
  return [...container.querySelectorAll<HTMLElement>(".skill-card")]
    .find((item) => item.querySelector("h3")?.textContent === title)!;
}

it("keeps navigation local and pins community and built-in plugin operations to the GUI home", async () => {
  await render();
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
  expect(document.getElementById("skills-market-tabs")!.childElementCount).toBe(0);
  expect(document.getElementById("skills-market-topbar-actions")!.childElementCount).toBe(0);
  expect(container.querySelector('[role="combobox"]')).toBeNull();
  expect(backend.loadAppSettings).not.toHaveBeenCalled();
  expect(backend.fetchSkillMarket).toHaveBeenCalledWith(GUI_CODEX_HOME_ID);
  expect(backend.invoke).toHaveBeenCalledWith("chrome_plugin_status", { homeId: GUI_CODEX_HOME_ID });
  expect(backend.invoke).toHaveBeenCalledWith("computer_use_status", { homeId: GUI_CODEX_HOME_ID });
  expect(backend.invoke).toHaveBeenCalledWith("remote_command_status", { homeId: GUI_CODEX_HOME_ID });
  await act(async () => card(community.title).querySelector<HTMLButtonElement>(".skill-install-button")!.click());
  expect(backend.installMarketSkill).toHaveBeenCalledWith(community, GUI_CODEX_HOME_ID);
  expect(backend.invoke).toHaveBeenCalledWith("chrome_plugin_action", {
    homeId: GUI_CODEX_HOME_ID, action: "ensureInstalled",
  });
  await act(async () => card("Chrome 浏览器助手")
    .querySelector<HTMLButtonElement>(".official-plugin-toggle")!.click());
  await act(async () => card("Computer Use 电脑助手")
    .querySelector<HTMLButtonElement>(".skill-install-button")!.click());
  expect(backend.invoke).toHaveBeenCalledWith("chrome_plugin_action", { homeId: GUI_CODEX_HOME_ID, action: "enable" });
  expect(backend.invoke).toHaveBeenCalledWith("computer_use_action", { homeId: GUI_CODEX_HOME_ID, action: "install" });
  await act(async () => card("远程命令")
    .querySelector<HTMLButtonElement>(".skill-install-button")!.click());
  expect(backend.invoke).toHaveBeenCalledWith("remote_command_action", { homeId: GUI_CODEX_HOME_ID, action: "install" });
  expect(card("远程命令").querySelector('input[type="checkbox"]')).toBeNull();
});

it("keeps community toggle and removal in the GUI home", async () => {
  backend.fetchSkillMarket.mockResolvedValue([{ ...community, installed: true, enabled: true,
    installedVersion: community.version }]);
  await render();
  await act(async () => card(community.title).querySelector<HTMLButtonElement>('button[role="switch"]')!.click());
  expect(backend.setMarketSkillEnabled).toHaveBeenCalledWith(community.id, false, GUI_CODEX_HOME_ID);
  await act(async () => card(community.title).querySelector<HTMLButtonElement>(".uninstall")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".ant-popconfirm .ant-btn-primary")!.click());
  expect(backend.removeMarketSkill).toHaveBeenCalledWith(community.id, GUI_CODEX_HOME_ID);
});

it("shows missing macOS grants and opens only the permission the user selects", async () => {
  backend.invoke.mockImplementation(async (command: string) => {
    if (command === "computer_use_status") return { supported: true, installed: true, enabled: true,
      needsRepair: false, version: "0.25.0", permissions: { accessibility: true, screenRecording: false } };
    return { supported: true, installed: false, enabled: false, version: "1.0.0" };
  });
  await render();
  const computer = card("Computer Use 电脑助手");
  expect(computer.querySelector('[aria-label="开启辅助功能"]')).toBeNull();
  const screenRecording = computer.querySelector<HTMLButtonElement>('[aria-label="开启屏幕录制"]')!;
  expect(screenRecording).not.toBeNull();
  expect(backend.invoke).not.toHaveBeenCalledWith("computer_use_request_permission", expect.anything());
  await act(async () => screenRecording.click());
  expect(backend.invoke).toHaveBeenCalledWith("computer_use_request_permission", { permission: "screenRecording" });
});

it("pins official listing, installation, toggling, and removal to the GUI home", async () => {
  await render();
  await selectTab("official");
  expect(backend.fetchOfficialPlugins).toHaveBeenCalledWith(GUI_CODEX_HOME_ID);
  expect(container.querySelector('[role="combobox"]')).toBeNull();
  backend.fetchOfficialPlugins.mockResolvedValue([{ ...official, installed: true, enabled: true }]);
  await act(async () => card(official.title).querySelector<HTMLButtonElement>(".skill-install-button")!.click());
  expect(backend.installOfficialPlugin).toHaveBeenCalledWith(official.id, GUI_CODEX_HOME_ID);
  await act(async () => card(official.title).querySelector<HTMLButtonElement>(".official-plugin-toggle")!.click());
  expect(backend.setOfficialPluginEnabled).toHaveBeenCalledWith(official.id, false, GUI_CODEX_HOME_ID);
  await act(async () => card(official.title).querySelector<HTMLButtonElement>(".uninstall")!.click());
  expect(backend.removeOfficialPlugin).toHaveBeenCalledWith(official.id, GUI_CODEX_HOME_ID);
  expect(backend.loadAppSettings).not.toHaveBeenCalled();
});

it("retains the shared prompt settings page and explains its scope", async () => {
  await render();
  await selectTab("prompt");
  expect(backend.fetchPromptPlugins).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("skills.prompt.scope");
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
  expect(container.querySelector('[role="combobox"]')).toBeNull();
});
