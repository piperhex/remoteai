// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChromePluginStatus } from "../../../api/chromePlugin";
import { setGuiLanguage } from "../../../../../../shared/localization/uiText";
import { useGuiLanguage } from "../../../../../../shared/localization/useGuiLanguage";
import { ChromePluginCard } from ".";
import { ManualInstall } from "./ManualInstall";

/** ManualInstall re-renders through ChromePluginCard, which subscribes to the interface language. */
function LanguageAwareManualInstall(props: Parameters<typeof ManualInstall>[0]) {
  useGuiLanguage();
  return <ManualInstall {...props} />;
}

const api = vi.hoisted(() => ({ chromePluginStatus: vi.fn(), chromePluginAction: vi.fn() }));
vi.mock("../../../api/chromePlugin", () => api);

const connected: ChromePluginStatus = { installed: true, enabled: true, needsRepair: false,
  connectedBrowsers: 2, activeBrowsers: 2, version: "1.0.0", supported: true, extensionDirectory: "C:/extension" };
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setGuiLanguage("zh");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setGuiLanguage("zh");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const text = (selector: string) => container.querySelector(selector)?.textContent;

it("switches the card copy with the interface language and keeps Chinese unchanged", async () => {
  api.chromePluginStatus.mockResolvedValue(connected);
  await act(async () => root.render(<ChromePluginCard homeId="gui" active onBusyChange={vi.fn()} />));
  expect(text("h3")).toBe("Chrome 浏览器助手");
  expect(text("[role=status]")).toBe("已连接 2 个浏览器");
  expect(text(".official-plugin-toggle")).toBe("停用");

  await act(async () => setGuiLanguage("ru"));
  expect(text("h3")).toBe("Браузерный помощник Chrome");
  expect(text(".skill-official-badge")).toBe("Встроенный плагин");
  expect(text("[role=status]")).toBe("Подключено браузеров: 2");
  expect(text(".official-plugin-toggle")).toBe("Отключить");
  expect(container.textContent).not.toMatch(/[\u4e00-\u9fff]/);

  await act(async () => setGuiLanguage("en"));
  expect(text("h3")).toBe("Chrome browser assistant");
  expect(text("[role=status]")).toBe("Connected browsers: 2");
  expect(container.textContent).not.toMatch(/[\u4e00-\u9fff]/);
});

it("labels the toggle as an action to enable the plugin, not as its state", async () => {
  api.chromePluginStatus.mockResolvedValue({ ...connected, enabled: false });
  await act(async () => root.render(<ChromePluginCard homeId="gui" active onBusyChange={vi.fn()} />));
  expect(text(".official-plugin-toggle")).toBe("启用");
  expect(text("[role=status]")).toBe("已停用");
  await act(async () => setGuiLanguage("ru"));
  expect(text(".official-plugin-toggle")).toBe("Включить");
  expect(text("[role=status]")).toBe("Отключено");
  await act(async () => setGuiLanguage("en"));
  expect(text(".official-plugin-toggle")).toBe("Enable");
});

it("translates the setup dialog together with the card", async () => {
  api.chromePluginStatus.mockResolvedValue({ ...connected, connectedBrowsers: 0, activeBrowsers: 0 });
  await act(async () => root.render(<ChromePluginCard homeId="gui" active onBusyChange={vi.fn()} />));
  await act(async () => container.querySelector<HTMLButtonElement>(".refresh-all")!.click());
  expect(document.querySelector(".ant-modal-title")?.textContent).toBe("安装并连接 Chrome 浏览器助手");
  expect(document.body.textContent).toContain("等待 Chrome 连接…");
  await act(async () => setGuiLanguage("ru"));
  expect(document.querySelector(".ant-modal-title")?.textContent)
    .toBe("Установка и подключение браузерного помощника Chrome");
  expect(document.body.textContent).toContain("Ожидание подключения Chrome…");
  expect(document.body.textContent).toContain("Проверить подключение");
  expect(document.querySelector(".ant-modal")?.textContent).not.toMatch(/[一-鿿]/);
});

it("keeps the extensions address in code inside the translated manual install hint", async () => {
  const onAction = vi.fn(async () => true);
  await act(async () => root.render(<LanguageAwareManualInstall extensionDirectory="C:/extension" busy={false}
    onAction={onAction} />));
  const hint = () => [...container.querySelectorAll("p")].find((node) => node.querySelector("code"));
  expect(hint()?.textContent).toBe("也可在 Chrome 地址栏输入 chrome://extensions/ 并回车。");
  await act(async () => setGuiLanguage("ru"));
  expect(hint()?.textContent).toBe("Также можно ввести chrome://extensions/ в адресной строке Chrome и нажать Enter.");
  expect(hint()?.querySelector("code")?.textContent).toBe("chrome://extensions/");
  await act(async () => setGuiLanguage("en"));
  expect(hint()?.textContent).toBe("You can also type chrome://extensions/ in the Chrome address bar and press Enter.");
});

it("shows the copy failure in the current interface language", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
  await act(async () => root.render(<LanguageAwareManualInstall extensionDirectory="C:/extension" busy={false}
    onAction={vi.fn(async () => true)} />));
  const copyButton = container.querySelector<HTMLButtonElement>("button[aria-label]")!;
  expect(copyButton.getAttribute("aria-label")).toBe("复制扩展目录路径");
  await act(async () => copyButton.click());
  expect(text("[role=alert]")).toBe("复制失败，请手动选择并复制路径。");
  await act(async () => setGuiLanguage("ru"));
  expect(text("[role=alert]")).toBe("Не удалось скопировать путь. Выделите и скопируйте его вручную.");
  expect(copyButton.getAttribute("aria-label")).toBe("Копировать путь к папке расширения");
});
