// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { GuiModelContextSettings } from "./GuiModelContextSettings";
import type { ModelContextSettings } from "./useModelContextSettings";

vi.mock("../../api/backend", () => ({ invoke: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let root: Root;
let container: HTMLDivElement;
let settings: ModelContextSettings;
const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const click = (element: HTMLElement) => act(async () => element.click());
const render = () => act(async () => root.render(<GuiModelContextSettings />));
async function type(label: string, value: string) {
  await act(async () => {
    nativeSet.call(input(label), value);
    input(label).dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const blur = (label: string) => act(async () => {
  input(label).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  const getComputedStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  settings = { defaults: { small: 128_000, large: 400_000 }, overrides: {} };
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) => {
    if (command === "codex_gui_set_model_context") {
      const model = args!.model as string;
      const capacity = args!.capacity as number | null;
      settings = { ...settings, overrides: { ...settings.overrides } };
      if (capacity === null) delete settings.overrides[model];
      else settings.overrides[model] = capacity;
      return settings;
    }
    return { ...settings, usingCachedDefaults: false };
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it("loads Admin defaults, persists only custom capacities, and resets to refreshed defaults", async () => {
  await render();
  expect(input("small 上下文容量").placeholder).toBe("128");
  expect(input("small 上下文容量").value).toBe("");
  await type("small 上下文容量", "1000"); await blur("small 上下文容量");
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_model_context", { model: "small", capacity: 1_000_000 });
  settings.defaults.small = 256_000;
  await click([...container.querySelectorAll("button")].find((button) => button.textContent === "刷新默认值")!);
  expect(input("small 上下文容量").value).toBe("1000");
  expect(input("small 上下文容量").placeholder).toBe("256");
  const reset = [...container.querySelectorAll("button")]
    .find((button) => button.textContent === "恢复默认" && !button.disabled)!;
  await click(reset);
  expect(invoke).toHaveBeenLastCalledWith("codex_gui_set_model_context", { model: "small", capacity: null });
  expect(input("small 上下文容量").value).toBe("");
  expect(settings.overrides).toEqual({});
});

it("keeps failed edits available for retry and rejects invalid capacities", async () => {
  await render();
  await type("small 上下文容量", "0"); await blur("small 上下文容量");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("请输入 1 至 100000 K");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("private path"));
  await type("small 上下文容量", "400"); await blur("small 上下文容量");
  expect(container.textContent).toContain("模型上下文设置未保存");
  expect(container.textContent).not.toContain("private path");
  expect(input("small 上下文容量").value).toBe("400");
  await blur("small 上下文容量");
  expect(settings.overrides.small).toBe(400_000);
});

it("adds a custom model and does not overwrite another model's setting", async () => {
  settings.overrides.small = 272_000;
  await render(); await type("添加模型名称", "custom-model"); await type("新模型上下文容量", "128.5");
  const add = [...container.querySelectorAll("button")]
    .find((button) => button.textContent?.replace(/\s/g, "") === "添加")!;
  await click(add);
  expect(settings.overrides).toEqual({ small: 272_000, "custom-model": 128_500 });
  expect(input("custom-model 上下文容量").value).toBe("128.5");
});

it("blocks overlapping writes while a save is pending", async () => {
  await render();
  let finish!: (value: ModelContextSettings) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await type("small 上下文容量", "400"); await blur("small 上下文容量");
  expect(input("large 上下文容量").disabled).toBe(true);
  await blur("small 上下文容量");
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => finish({ ...settings, overrides: { small: 400_000 } }));
  expect(input("large 上下文容量").disabled).toBe(false);
});
