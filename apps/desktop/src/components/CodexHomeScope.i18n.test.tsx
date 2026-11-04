// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CodexHomeScope, CodexHomeSelect, homeLabel } from "./CodexHomeScope";
import { uiText, setGuiLanguage } from "../../../../shared/localization/uiText";

const backend = vi.hoisted(() => ({ loadAppSettings: vi.fn() }));
vi.mock("../api/backend", () => ({ loadAppSettings: backend.loadAppSettings, hasLocalBackend: true }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));

let container: HTMLDivElement;
let root: Root;
const defaultHome = { id: "default", path: "C:/codex {value1}", enabled: true };
const guiHome = { id: "codex-gui", path: "C:/app/.codex", enabled: false };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setGuiLanguage("zh");
});

it("labels built-in homes in the interface language and keeps paths verbatim", () => {
  expect(homeLabel(guiHome, "zh")).toBe("内置 Codex GUI");
  expect(homeLabel(defaultHome, "zh")).toBe("默认目录 · C:/codex {value1}");
  expect(homeLabel(guiHome, "en")).toBe("Built-in Codex GUI");
  expect(homeLabel(defaultHome, "en")).toBe("Default folder · C:/codex {value1}");
  expect(homeLabel(defaultHome, "ru")).toBe("Папка по умолчанию · C:/codex {value1}");
  expect(homeLabel({ id: "custom", path: "D:/默认目录", enabled: true }, "ru")).toBe("D:/默认目录");
});

it("shows the load error, retry button and selector label in Russian", async () => {
  setGuiLanguage("ru");
  backend.loadAppSettings.mockRejectedValueOnce(new Error("offline"));
  await act(async () => root.render(<CodexHomeScope><CodexHomeSelect /></CodexHomeScope>));
  expect(container.textContent).toContain(uiText("client.desktopMisc.couldNotLoadTheFolderListPleaseTryAgain", {}, "ru"));
  expect(container.textContent).not.toMatch(/[\u4e00-\u9fff]/);
  backend.loadAppSettings.mockResolvedValueOnce({ codexHomes: [defaultHome] });
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("input[role=combobox]")?.getAttribute("aria-label"))
    .toBe(uiText("client.desktopMisc.chooseTheCodexHomeToManage", {}, "ru"));
  expect(container.textContent).toContain("Папка по умолчанию · C:/codex {value1}");
});

it("translates the TOML column fragment so Russian has no Chinese punctuation", () => {
  const column = (language: "zh" | "en" | "ru") => uiText("client.configHelp.line", {
    value1: 3, value2: uiText("client.desktopMisc.column", { value1: 5 }, language),
  }, language);
  expect(column("zh")).toBe("第 3 行，第 5 列");
  expect(column("en")).toBe("Line 3, column 5");
  expect(column("ru")).toContain("столбец 5");
  expect(column("ru")).not.toMatch(/[\u4e00-\u9fff，]/);
});
