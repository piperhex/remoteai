import { resources as clientResources } from '@remoteai/i18n/client';
const english: Readonly<Record<string, string>> = clientResources.en;
const russianCopy: Readonly<Record<string, string>> = clientResources.ru;
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";


import { setGuiLanguage } from "../../../../../shared/localization/uiText";
import { ComputerUseCard } from "./ComputerUseCard";
import { RemoteCommandCard } from "./RemoteCommandCard";

const api = vi.hoisted(() => ({
  computerUseStatus: vi.fn(), computerUseAction: vi.fn(), requestComputerUsePermission: vi.fn(),
  remoteCommandStatus: vi.fn(), remoteCommandAction: vi.fn(),
}));
vi.mock("../../api/computerUse", () => ({
  computerUseStatus: api.computerUseStatus, computerUseAction: api.computerUseAction,
  requestComputerUsePermission: api.requestComputerUsePermission,
}));
vi.mock("../../api/remoteCommand", () => ({
  remoteCommandStatus: api.remoteCommandStatus, remoteCommandAction: api.remoteCommandAction,
}));

const han = /[一-鿿]/;
const russian: Readonly<Record<string, string>> = russianCopy;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  setGuiLanguage("zh");
  vi.unstubAllGlobals();
});

const ariaLabels = () => [...container.querySelectorAll("[aria-label]")].map(node => node.getAttribute("aria-label"));
const buttonText = () => [...container.querySelectorAll("button")].map(button => button.textContent);

it("keeps the Chinese Computer Use copy and switches it to Russian without remounting", async () => {
  api.computerUseStatus.mockResolvedValue({ supported: true, installed: true, enabled: true, needsRepair: false,
    version: "0.25.0", permissions: { accessibility: true, screenRecording: false } });
  await act(async () => root.render(<ComputerUseCard homeId="codex-gui" active onBusyChange={vi.fn()} />));
  expect(container.textContent).toContain("Computer Use 电脑助手");
  expect(container.textContent).toContain("已安装 · 请开启桌面操作权限");
  expect(container.textContent).toContain("请在系统设置中为 Remote AI 开启以下权限：");
  expect(ariaLabels()).toEqual(["开启屏幕录制"]);
  expect(buttonText()).toEqual(["去开启", "停用", "卸载"]);

  await act(async () => setGuiLanguage("ru"));
  expect(container.textContent).toContain("Компьютерный помощник Computer Use");
  expect(container.textContent).toContain(russian["client.desktopBuiltinPlugins.installedAllowDesktopControlPermissions"]);
  expect(container.textContent).toContain("Универсальный доступ");
  expect(ariaLabels()).toEqual(["Разрешить запись экрана"]);
  expect(buttonText()).toEqual(["Разрешить", "Отключить", "Удалить"]);
  expect(container.textContent).not.toMatch(han);

  await act(async () => container.querySelector<HTMLButtonElement>(".uninstall")!.click());
  const confirm = document.querySelector(".ant-popconfirm")!;
  expect(confirm.textContent).toContain("Удалить Computer Use из этой папки?");
  expect(confirm.textContent).toContain("Отмена");
  expect(confirm.textContent).not.toMatch(han);
});

it("uses the Enable action label and shows remote command errors in the interface language", async () => {
  setGuiLanguage("ru");
  api.remoteCommandStatus.mockResolvedValueOnce({ installed: true, enabled: false, needsRepair: false,
    version: "1.0.0" });
  await act(async () => root.render(<RemoteCommandCard homeId="codex-gui" active onBusyChange={vi.fn()} />));
  expect(container.querySelector("h3")?.textContent).toBe("Удалённые команды");
  expect(container.querySelector("[role=status]")?.textContent).toBe(russian["client.desktopBuiltinPlugins.disabledCanTSendOrReceiveRemoteCommands"]);
  expect(buttonText()).toEqual(["Включить", "Удалить"]);

  api.remoteCommandAction.mockRejectedValueOnce("操作未完成，请重试。");
  await act(async () => container.querySelector<HTMLButtonElement>(".official-plugin-toggle")!.click());
  expect(container.querySelector("[role=alert]")?.textContent).toBe(russian["client.projectExplorer.actionError"]);
  expect(buttonText()).toContain("Проверить снова");
  expect(container.textContent).not.toMatch(han);
});

it("has English and Russian copy for every semantic key in the built-in plugin cards", () => {
  const files = ["./ComputerUseCard/index.tsx", "./ComputerUseCard/Permissions.tsx", "./RemoteCommandCard/index.tsx",
    "./OfficialPluginsMarket/CliInstallButton.tsx", "./OfficialPluginsMarket/index.tsx"];
  const sources = files
    .flatMap(file => [...readFileSync(new URL(file, import.meta.url), "utf8").matchAll(/["'](client\.[^"'\n]+)["']/g)])
    .map(match => match[1])
    // Search alias strings are matched against user queries and never displayed.
    .filter(source => !/^(computer use|remote command) /.test(source));
  expect(sources.length).toBeGreaterThan(40);
  for (const source of sources) {
    expect(english[source], source).toBeTruthy();
    expect(russian[source], source).toBeTruthy();
    expect(english[source], source).not.toMatch(han);
    expect(russian[source], source).not.toMatch(han);
  }
});
