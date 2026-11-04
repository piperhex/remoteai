// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "../../../../../shared/conversation/api";
import { GuiController } from "./controller";
import type { Model } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const model = (name: string): Model => ({ id: name, model: name, displayName: name, isDefault: true,
  defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }] });
const official = model("gpt-6-astra");
const thirdParty = model("kimi-k3");

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(vi.fn());
  vi.mocked(guiApi.request).mockImplementation(async (request) => ({
    data: request.operation === "models" ? [official] : [], nextCursor: null,
  }));
});

it("preserves concrete model and effort selections when switching Providers and back", async () => {
  const controller = new GuiController();
  await controller.connect();
  expect(controller.getSnapshot().settings).toMatchObject({ model: official.model, effort: "high" });
  controller.settings({ model: official.model, effort: "high" });
  await controller.setModels([thirdParty]);
  expect(controller.getSnapshot().models).toEqual([thirdParty]);
  expect(controller.getSnapshot().settings).toMatchObject({ model: official.model, effort: "high" });
  expect(await controller.send("blocked", [])).toBe(false);
  await controller.setModels([thirdParty]);
  expect(controller.getSnapshot().settings).toMatchObject({ model: official.model, effort: "high" });
  await controller.setModels([official]);
  expect(controller.getSnapshot().models).toEqual([official]);
  expect(controller.getSnapshot().settings).toMatchObject({ model: official.model, effort: "high" });
  controller.dispose();
});

it("discards the old account response after changing Providers while loading", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "models"
    ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ data: [], nextCursor: null }));
  const controller = new GuiController();
  const connecting = controller.connect();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await controller.setModels([thirdParty]);
  controller.settings({ model: thirdParty.model, effort: "high" });
  vi.mocked(guiApi.request).mockResolvedValue({ data: [model("deepseek-v3")], nextCursor: null });
  const switching = controller.modelCatalog.invalidate();
  finish({ data: [official], nextCursor: null });
  await connecting;
  await switching;
  expect(controller.getSnapshot().models.map((entry) => entry.model)).toEqual(["deepseek-v3"]);
  controller.dispose();
});

it("updates the catalog during an active turn without reconnecting or changing that turn", async () => {
  const controller = new GuiController();
  await controller.connect();
  const receive = vi.mocked(guiApi.subscribe).mock.calls[0][0];
  receive({ method: "thread/started", params: { thread: { id: "live", cwd: "", preview: "", updatedAt: 1 } } });
  receive({ method: "turn/started", params: { threadId: "live",
    turn: { id: "turn", status: "inProgress", items: [] } } });
  const before = controller.getSnapshot().conversations.live;
  vi.mocked(guiApi.connect).mockClear();
  vi.mocked(guiApi.request).mockClear();
  await controller.setModels([thirdParty]);
  expect(controller.getSnapshot().models).toEqual([thirdParty]);
  expect(controller.getSnapshot().conversations.live).toBe(before);
  expect(controller.getSnapshot().conversations.live.activeTurn).toBe("turn");
  expect(guiApi.connect).not.toHaveBeenCalled();
  expect(guiApi.request).not.toHaveBeenCalled();
  controller.dispose();
});

it("sends the concrete model and effort shown after loading the catalog", async () => {
  const controller = new GuiController();
  await controller.connect();
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "start"
    ? { thread: { id: "new", cwd: "", preview: "", updatedAt: 1 } }
    : { turn: { id: "turn", status: "completed", items: [] } });
  expect(await controller.send("hello", [])).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "start", model: official.model }));
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({
    operation: "send", model: official.model, effort: "high",
  }));
  controller.dispose();
});
