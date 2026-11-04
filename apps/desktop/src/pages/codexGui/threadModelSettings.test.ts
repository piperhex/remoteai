// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuiController } from "./controller";
import { guiApi } from "../../../../../shared/conversation/api";
import type { Model } from "../../../../../shared/conversation/types";
import type { ModelSettingsApi, ModelSettingsSnapshot } from "./threadModelSettings";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const models: Model[] = ["first", "second"].map((model, index) => ({
  id: model, model, displayName: model, isDefault: index === 0, defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map((reasoningEffort) =>
    ({ reasoningEffort, description: "" })),
}));
const stops: (() => void)[] = [];
const controllers: GuiController[] = [];

function backend() {
  const saved = new Map<string | null, ModelSettingsSnapshot>();
  const listeners = new Set<(snapshot: ModelSettingsSnapshot) => void>();
  const emit = (snapshot: ModelSettingsSnapshot) => listeners.forEach((receive) => receive(snapshot));
  const api: ModelSettingsApi = {
    read: vi.fn(async (threadId) => saved.get(threadId) ?? { threadId, selection: null, revision: 0 }),
    write: vi.fn(async (threadId, selection) => {
      const snapshot = { threadId, selection, revision: (saved.get(threadId)?.revision ?? 0) + 1 };
      saved.set(threadId, snapshot); emit(snapshot); return snapshot;
    }),
    subscribe: vi.fn(async (receive) => { listeners.add(receive); return () => { listeners.delete(receive); }; }),
  };
  return { api, saved, emit, listeners };
}

async function client(api?: ModelSettingsApi) {
  const controller = new GuiController();
  controllers.push(controller);
  await controller.connect();
  if (api) {
    stops.push(controller.modelSettings.start(api));
    await vi.waitFor(() => expect(controller.getSnapshot().modelSettingsLoading).toBe(false));
  }
  return controller;
}

beforeEach(() => {
  localStorage.clear(); vi.resetAllMocks();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockResolvedValue(vi.fn());
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "models") return { data: models, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    if (request.operation === "send" || request.operation === "sendBatch") {
      return { turn: { id: "turn", status: "completed", items: [] } };
    }
    return { thread: { id: "threadId" in request ? request.threadId : "created", cwd: "", preview: "", updatedAt: 1 } };
  });
});

afterEach(() => { stops.splice(0).forEach((stop) => stop()); controllers.splice(0).forEach((c) => c.dispose()); });

it("keeps conversation choices separate and sends the setting restored after switching", async () => {
  const controller = await client();
  controller.settings({ model: "second", effort: "low" });
  await controller.select("a"); controller.settings({ model: "first", effort: "xhigh" });
  await controller.select("b"); controller.settings({ model: "second", effort: "high" });
  await controller.select("a");
  expect(controller.getSnapshot().settings).toMatchObject({ model: "first", effort: "xhigh" });
  expect(await controller.send("hello", [])).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "send", threadId: "a",
    model: "first", effort: "xhigh" }));
  controller.newConversation();
  expect(controller.getSnapshot().settings).toMatchObject({ model: "first", effort: "xhigh" });
  expect(await controller.send("new", [])).toBe(true);
  await controller.select("b"); await controller.select("created");
  expect(controller.getSnapshot().settings).toMatchObject({ model: "first", effort: "xhigh" });
});

it("synchronizes the same conversation across clients and restores it after refresh", async () => {
  const { api } = backend();
  const pc = await client(api); const web = await client(api);
  await pc.select("a"); await web.select("b");
  web.settings({ model: "second", effort: "low" });
  await vi.waitFor(() => expect(web.getSnapshot().modelSettingsLoading).toBe(false));
  pc.settings({ model: "first", effort: "xhigh" });
  await vi.waitFor(() => expect(pc.getSnapshot().modelSettingsLoading).toBe(false));
  expect(web.getSnapshot().settings).toMatchObject({ model: "second", effort: "low" });
  await web.select("a");
  expect(web.getSnapshot().settings).toMatchObject({ model: "first", effort: "xhigh" });
  web.settings({ effort: "high" });
  await vi.waitFor(() => expect(pc.getSnapshot().settings.effort).toBe("high"));
  const refreshed = await client(api);
  await refreshed.select("a");
  expect(refreshed.getSnapshot().settings).toMatchObject({ model: "first", effort: "high" });
  await refreshed.select("b");
  expect(refreshed.getSnapshot().settings).toMatchObject({ model: "second", effort: "low" });
});

it("ignores late reads after switching and reads older than an incoming change", async () => {
  const { api, emit } = backend();
  const controller = await client(api);
  const finish: ((snapshot: ModelSettingsSnapshot) => void)[] = [];
  vi.mocked(api.read).mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  const first = controller.select("a"); const second = controller.select("b");
  emit({ threadId: "b", selection: { model: "second", effort: "xhigh" }, revision: 2 });
  finish[1]({ threadId: "b", selection: { model: "first", effort: "low" }, revision: 1 });
  finish[0]({ threadId: "a", selection: { model: "first", effort: "medium" }, revision: 1 });
  await Promise.all([first, second]);
  expect(controller.getSnapshot()).toMatchObject({ selected: "b", modelSettingsLoading: false,
    settings: { model: "second", effort: "xhigh" } });
});

it("serializes slider saves and keeps a newer external event received before the acknowledgement", async () => {
  const { api, emit } = backend();
  const controller = await client(api); await controller.select("a");
  const finish: ((snapshot: ModelSettingsSnapshot) => void)[] = [];
  vi.mocked(api.write).mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  controller.settings({ effort: "high" }); controller.settings({ effort: "low" });
  expect(api.write).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().settings.effort).toBe("low");
  expect(await controller.send("wait", [])).toBe(false);
  finish[0]({ threadId: "a", selection: { model: "first", effort: "high" }, revision: 1 });
  await vi.waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
  emit({ threadId: "a", selection: { model: "second", effort: "xhigh" }, revision: 3 });
  finish[1]({ threadId: "a", selection: { model: "first", effort: "low" }, revision: 2 });
  await vi.waitFor(() => expect(controller.getSnapshot().modelSettingsLoading).toBe(false));
  expect(controller.getSnapshot().settings).toMatchObject({ model: "second", effort: "xhigh" });
});

it("updates only waiting messages in the changed conversation", async () => {
  const { api, emit } = backend(); const controller = await client(api);
  await controller.select("a"); controller.queue.enqueue("a", { text: "a", images: [], skills: [] });
  await controller.select("b"); controller.queue.enqueue("b", { text: "b", images: [], skills: [] });
  const before = controller.getSnapshot().queued.b;
  emit({ threadId: "a", selection: { model: "second", effort: "xhigh" }, revision: 1 });
  expect(controller.getSnapshot().queued.a[0]).toMatchObject({ model: "second", effort: "xhigh" });
  expect(controller.getSnapshot().queued.b).toBe(before);
  expect(controller.getSnapshot().settings.model).toBe("first");
});

it("retains an unsaved choice after failure and retries it when reconnecting", async () => {
  const { api } = backend(); const controller = await client(api); await controller.select("a");
  vi.mocked(api.write).mockRejectedValueOnce(new Error("private error"));
  controller.settings({ model: "second", effort: "xhigh" });
  await vi.waitFor(() => expect(controller.getSnapshot().error).toContain("模型设置暂未同步"));
  expect(controller.getSnapshot().error).not.toContain("private");
  expect(await controller.send("wait", [])).toBe(false);
  await controller.connect();
  await vi.waitFor(() => expect(controller.getSnapshot().modelSettingsLoading).toBe(false));
  expect(controller.getSnapshot().settings).toMatchObject({ model: "second", effort: "xhigh" });
});

it("retries a failed subscription on reconnect and releases it on unmount", async () => {
  const { api, listeners } = backend(); const controller = await client();
  vi.mocked(api.subscribe).mockRejectedValueOnce(new Error("offline"));
  const stop = controller.modelSettings.start(api);
  stops.push(stop);
  await vi.waitFor(() => expect(controller.getSnapshot().error).toContain("模型设置暂未同步"));
  await controller.select("a");
  expect(controller.getSnapshot().modelSettingsLoading).toBe(true);
  await controller.connect();
  expect(controller.getSnapshot().modelSettingsLoading).toBe(false);
  expect(api.subscribe).toHaveBeenCalledTimes(2);
  expect(listeners.size).toBe(1);
  stop(); expect(listeners.size).toBe(0);
});

it("keeps a pending send on its original conversation without changing the viewed conversation", async () => {
  const controller = await client();
  await controller.select("a"); controller.settings({ model: "first", effort: "xhigh" });
  const original = vi.mocked(guiApi.request).getMockImplementation()!;
  let finish!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation((request) => request.operation === "resume"
    ? new Promise((resolve) => { finish = resolve; }) : original(request));
  const sending = controller.send("send a", []);
  await controller.select("b"); controller.settings({ model: "second", effort: "low" });
  finish({ thread: { id: "a", cwd: "", preview: "a", updatedAt: 1 } });
  expect(await sending).toBe(true);
  expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "send", threadId: "a",
    model: "first", effort: "xhigh" }));
  expect(controller.getSnapshot()).toMatchObject({ selected: "b", settings: { model: "second", effort: "low" } });
});


const changes = (controller: GuiController) => controller.getSnapshot().conversations.a.turns
  .flatMap((turn) => turn.items).filter((item) => item.type === "modelChange");

it.each(["applied", "nextTurn", "failed"] as const)("reports the acknowledged live switch outcome: %s", async (liveUpdate) => {
  const { api } = backend(); const controller = await client(api); await controller.select("a");
  vi.mocked(guiApi.subscribe).mock.calls[0][0]({ method: "turn/started", params: { threadId: "a",
    turn: { id: "live", status: "inProgress", items: [] } } });
  let finish!: (snapshot: ModelSettingsSnapshot) => void;
  vi.mocked(api.write).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.mocked(guiApi.request).mockClear();
  controller.settings({ model: "second", effort: "high" });
  expect(changes(controller)).toEqual([]);
  expect(guiApi.request).not.toHaveBeenCalled();
  finish({ threadId: "a", selection: { model: "second", effort: "high" }, revision: 1, liveUpdate });
  await vi.waitFor(() => expect(controller.getSnapshot().modelSettingsLoading).toBe(false));
  expect(controller.getSnapshot().conversations.a.activeTurn).toBe("live");
  const [notice] = changes(controller);
  expect(notice.success).toBe(liveUpdate !== "failed");
  if (liveUpdate === "failed") expect(notice.text).toContain("未能更新");
  else {
    expect(notice.text).toBe("模型已从 first 更改为 second");
    expect(notice.summary?.[0]).toContain(liveUpdate === "applied" ? "下一次请求" : "下一轮对话");
    expect(notice.summary?.[0]).toContain("可能使响应变慢");
  }
  expect(controller.getSnapshot().settings.model).toBe("second");
});

it("waits for the latest rapid live selection before showing success", async () => {
  const { api } = backend(); const controller = await client(api); await controller.select("a");
  vi.mocked(guiApi.subscribe).mock.calls[0][0]({ method: "turn/started", params: { threadId: "a",
    turn: { id: "live", status: "inProgress", items: [] } } });
  const finish: ((snapshot: ModelSettingsSnapshot) => void)[] = [];
  vi.mocked(api.write).mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  controller.settings({ model: "second", effort: "high" });
  controller.settings({ model: "first", effort: "low" });
  expect(api.write).toHaveBeenCalledTimes(1);
  finish[0]({ threadId: "a", selection: { model: "second", effort: "high" }, revision: 1, liveUpdate: "applied" });
  await vi.waitFor(() => expect(finish).toHaveLength(2));
  expect(changes(controller)).toEqual([]);
  finish[1]({ threadId: "a", selection: { model: "first", effort: "low" }, revision: 2, liveUpdate: "failed" });
  await vi.waitFor(() => expect(changes(controller)[0]?.success).toBe(false));
  expect(controller.getSnapshot().settings.model).toBe("first");
});
