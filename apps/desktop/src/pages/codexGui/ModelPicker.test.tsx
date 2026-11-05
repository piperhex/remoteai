// @vitest-environment jsdom
import { act, useEffect, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { GuiController } from "./controller";
import { ModelPicker } from "./ModelPicker";
import { useUsageStatus } from "./useUsageStatus";
import type { Model } from "../../../../../shared/conversation/types";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isDesktopApp: false,
  isHostedWebApp: false, canManageCodexConnection: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
const models: Model[] = ["kimi-k3", "deepseek-v3"].map((model) => ({
  id: model, model, displayName: model, isDefault: true, defaultReasoningEffort: "high",
  supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
}));
let root: Root;
let container: HTMLDivElement;
let controller: GuiController;

function Fixture({ catalog }: { catalog: Model[] }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { usage } = useUsageStatus(true);
  useEffect(() => { controller.setModels(catalog); }, [catalog]);
  return <><span>{usage?.totalTokens ?? "刷新中"}</span><ModelPicker models={state.models}
    model={state.settings.model} effort={state.settings.effort} onChange={controller.settings} disabled={false} /></>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  localStorage.clear();
  controller = new GuiController();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  controller.dispose();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("updates an open menu and accepts selections while usage polling waits for a response", async () => {
  const finish: ((value: unknown) => void)[] = [];
  vi.mocked(invoke).mockReset().mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  await act(async () => root.render(<Fixture catalog={[models[0]]} />));
  expect(container.querySelector("button")?.textContent).toBe("kimi-k3高");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!.click());
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("kimi-k3");
  await act(async () => root.render(<Fixture catalog={[models[1]]} />));
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("deepseek-v3");
  expect(menu.textContent).not.toContain("kimi-k3");
  expect(menu.textContent).not.toContain("默认");
  expect(container.querySelector("button")?.textContent).toBe("kimi-k3高");
  expect(container.querySelector("button")?.getAttribute("data-model-unavailable")).toBe("true");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
    menu.querySelector<HTMLButtonElement>("button")!.click();
  });
  expect(controller.getSnapshot().settings.model).toBe("deepseek-v3");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'codex_gui_usage_summary')).toHaveLength(1);
  await act(async () => finish.forEach((resolve) => resolve({
    totalTokens: 123, estimatedCostUsd: 0.1, running: true,
  })));
  expect(container.textContent).toContain("123");
  expect(controller.getSnapshot().settings.model).toBe("deepseek-v3");
});

it("opens without fetching and displays model changes received while open", async () => {
  const onChange = vi.fn();
  let finish!: (models: Model[]) => void;
  const pending = new Promise<Model[]>((resolve) => { finish = resolve; });
  const onRetry = vi.fn();
  void pending.then((models) => render(models));
  const render = (catalog: Model[]) => root.render(<ModelPicker models={catalog} model={models[0].model}
    effort="high" disabled={false} onChange={onChange} onRetry={onRetry} />);
  await act(async () => render([models[0]]));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!.click());
  expect(onRetry).not.toHaveBeenCalled();
  const released = { ...models[1], id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1 Sol" };
  await act(async () => finish([models[0], released]));
  const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    .find((button) => button.textContent === "GPT-6.1 Sol")!;
  expect(option.disabled).toBe(false);
  await act(async () => option.click());
  expect(onChange).toHaveBeenCalledWith({ model: "gpt-6.1-sol", effort: "high" });
});

it("shows a concrete initial selection and restores the recommended effort by name", async () => {
  const catalog = [{ ...models[0], displayName: "Kimi K3",
    supportedReasoningEfforts: ["low", "high", "max"].map((reasoningEffort) => ({ reasoningEffort, description: "" })) }];
  const onChange = vi.fn();
  const render = (effort: string) => act(async () => root.render(<ModelPicker models={catalog}
    model="" effort={effort} disabled={false} onChange={onChange} />));
  await render("");
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  expect(trigger.textContent).toBe("Kimi K3高");
  expect(trigger.getAttribute("aria-label")).toBe("模型与推理强度：Kimi K3 高");
  await act(async () => root.render(<ModelPicker models={catalog} model="kimi-k3"
    effort="max" disabled={false} onChange={onChange} />));
  expect(trigger.textContent).toBe("Kimi K3最高");
  await act(async () => trigger.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="恢复推荐推理强度"]')!.click());
  expect(onChange).toHaveBeenLastCalledWith({ model: "kimi-k3", effort: "high" });
});

it("offers retry after an initial load fails and returns to loading while retrying", async () => {
  const retry = vi.fn();
  const render = (error?: string) => root.render(<ModelPicker models={[]} model="" effort=""
    disabled onChange={vi.fn()} onRetry={retry} error={error} />);
  await act(async () => render());
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  expect(trigger.textContent).toBe("正在加载模型…");
  expect(trigger.disabled).toBe(true);
  await act(async () => render("offline"));
  expect(trigger.textContent).toBe("模型加载失败，点击重试");
  expect(trigger.disabled).toBe(false);
  await act(async () => trigger.click());
  expect(retry).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await act(async () => render());
  expect(trigger.disabled).toBe(true);
  expect(trigger.getAttribute("aria-busy")).toBe("true");
});

it("distinguishes an empty catalog from loading and offers a retry", async () => {
  const retry = vi.fn();
  await act(async () => root.render(<ModelPicker models={[]} model="" effort="" disabled={false}
    onChange={vi.fn()} onRetry={retry} />));
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  expect(trigger.textContent).toBe("暂无可用模型，点击重试");
  expect(trigger.disabled).toBe(false);
  await act(async () => trigger.click());
  expect(retry).toHaveBeenCalledOnce();
});

it("offers retry instead of selecting stale models after an account switch fails", async () => {
  const retry = vi.fn();
  const change = vi.fn();
  await act(async () => root.render(<ModelPicker models={models} model={models[0].model} effort="high"
    disabled onChange={change} onRetry={retry} error="offline" />));
  const trigger = container.querySelector<HTMLButtonElement>("button")!;
  expect(trigger.textContent).toBe("模型加载失败，点击重试");
  expect(trigger.disabled).toBe(false);
  await act(async () => trigger.click());
  expect(retry).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
});
