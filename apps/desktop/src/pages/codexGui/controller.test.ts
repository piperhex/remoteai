// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuiEvent, Request, Thread } from "./types";
import { GuiController } from "./controller";
import { guiApi } from "./api";
import { testModels } from "./testModels";

vi.mock("./api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn(), respond: vi.fn() } }));
const thread: Thread = { id: "one", cwd: "D:/project", preview: "hello", updatedAt: 1, turns: [] };
let receive: (event: GuiEvent) => void;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => {
    receive = callback;
    return vi.fn<() => void>();
  });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "models") return { data: testModels, nextCursor: null };
    if (request.operation === "list") return { data: [], nextCursor: null };
    return { thread };
  });
});

describe("Codex GUI controller", () => {
  it("permits chatting while unattended setup waits and after it fails", async () => {
    const controller = new GuiController();
    await controller.connect();
    receive({ method: "computerUse/setup", params: { computerUseSetup: "ready" } });
    receive({ method: "unattended/setup", params: { unattendedSetup: "installing" } });
    const original = vi.mocked(guiApi.request).getMockImplementation()!;
    vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "send"
      ? { turn: { id: "reply", status: "completed", items: [] } } : original(request));
    expect(await controller.send("continue during setup", [])).toBe(true);
    receive({ method: "unattended/setup", params: { unattendedSetup: "failed" } });
    expect(controller.getSnapshot()).toMatchObject({ connection: "ready", computerUseSetup: "ready",
      unattendedSetup: "failed", error: "", approvals: [] });
    expect(await controller.send("continue after cancellation", [])).toBe(true);
    expect(guiApi.connect).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("keeps setup single-flight and permits chatting after assistant installation fails", async () => {
    const controller = new GuiController();
    let finish!: (events: GuiEvent[]) => void;
    vi.mocked(guiApi.connect).mockImplementation(() => {
      receive({ method: "computerUse/setup", params: { computerUseSetup: "installing" } });
      return new Promise((resolve) => { finish = resolve; });
    });
    const connection = controller.connect();
    await Promise.resolve();
    expect(controller.connect()).toBe(connection);
    await vi.waitFor(() => expect(controller.getSnapshot().computerUseSetup).toBe("installing"));
    expect(await controller.send("wait", [])).toBe(false);
    receive({ method: "computerUse/setup", params: { computerUseSetup: "failed" } });
    finish([]);
    await connection;
    expect(controller.getSnapshot()).toMatchObject({ connection: "ready", computerUseSetup: "failed", error: "" });
    expect(guiApi.connect).toHaveBeenCalledTimes(1);
    const original = vi.mocked(guiApi.request).getMockImplementation()!;
    vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "send"
      ? { turn: { id: "reply", status: "completed", items: [] } } : original(request));
    expect(await controller.send("hello", [])).toBe(true);
    controller.dispose();
  });

  it("keeps in-flight settings stable and uses changes for the next request", async () => {
    const controller = new GuiController();
    await controller.connect();
    await controller.select(thread.id);
    const previous = { model: "old-model", effort: "low", access: "read-only" } as const;
    const next = { model: "next-model", effort: "high", access: "workspace-write" } as const;
    controller.settings(previous);
    const original = vi.mocked(guiApi.request).getMockImplementation()!;
    let resume!: (value: unknown) => void;
    vi.mocked(guiApi.request).mockImplementation((request) => {
      if (request.operation === "resume") return new Promise((resolve) => { resume = resolve; });
      if (request.operation === "send") return Promise.resolve({
        turn: { id: crypto.randomUUID(), status: "completed", items: [] } });
      return original(request);
    });
    const sending = controller.send("first", []);
    expect(controller.getSnapshot().sending).toBe(true);
    controller.settings(next);
    resume({ thread });
    expect(await sending).toBe(true);
    expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "send", ...previous }));
    const following = controller.send("second", []);
    resume({ thread });
    expect(await following).toBe(true);
    const sends = vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "send");
    expect(sends.at(-1)?.[0]).toMatchObject(next);
    controller.dispose();
  });

  it("applies access changes to each turn even when resume returns the same loaded thread", async () => {
    const controller = new GuiController();
    await controller.connect();
    await controller.select(thread.id);
    const original = vi.mocked(guiApi.request).getMockImplementation()!;
    vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "send"
      ? { turn: { id: crypto.randomUUID(), status: "completed", items: [] } } : original(request));
    for (const access of ["danger-full-access", "read-only", "workspace-write"] as const) {
      controller.settings({ access });
      expect(await controller.send("continue", [])).toBe(true);
      const sends = vi.mocked(guiApi.request).mock.calls.filter(([request]) => request.operation === "send");
      expect(sends.at(-1)?.[0]).toMatchObject({ threadId: thread.id, access });
    }
    controller.dispose();
  });

  it("reopens the selected conversation after refresh and clears it for a new chat", async () => {
    const first = new GuiController();
    await first.connect(); await first.select(thread.id); first.dispose();
    const restored = new GuiController();
    expect(restored.getSnapshot().selected).toBe(thread.id);
    await restored.connect();
    expect(restored.getSnapshot().conversations[thread.id].thread).toEqual(thread);
    restored.newConversation(); restored.dispose();
    expect(new GuiController().getSnapshot().selected).toBeNull();
  });

  it("creates and sends a new conversation with the last permission after reopening", async () => {
    const previous = new GuiController();
    await previous.connect(); await previous.select(thread.id);
    previous.settings({ access: "danger-full-access" }); previous.dispose();
    const controller = new GuiController();
    await controller.connect(); controller.newConversation();
    expect(controller.getSnapshot().settings.access).toBe("danger-full-access");
    const original = vi.mocked(guiApi.request).getMockImplementation()!;
    vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "send"
      ? { turn: { id: "reply", status: "completed", items: [] } } : original(request));
    expect(await controller.send("hello", [])).toBe(true);
    for (const operation of ["start", "send"]) {
      expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation, access: "danger-full-access" }));
    }
    controller.dispose();
  });
  it("reloads a live conversation after a browser connection gap", async () => {
    const controller = new GuiController();
    await controller.connect();
    await controller.select(thread.id);
    receive({ method: "turn/started", params: { threadId: thread.id,
      turn: { id: "live", status: "inProgress", items: [] } } });
    receive({ method: "connection/closed", params: {} });
    expect(controller.getSnapshot().connection).toBe("offline");
    vi.mocked(guiApi.request).mockClear();
    receive({ method: "connection/restored", params: {} });
    await controller.connect();
    expect(guiApi.request).toHaveBeenCalledWith({ operation: "read", threadId: thread.id });
    expect(controller.getSnapshot().connection).toBe("ready");
    controller.dispose();
  });

  it("refreshes after an automatic CLI update while reusing the replacement connection", async () => {
    const controller = new GuiController();
    await controller.connect();
    await controller.select(thread.id);
    vi.mocked(guiApi.connect).mockClear();
    receive({ method: "connection/updated", params: {} });
    await controller.connect();
    expect(guiApi.connect).toHaveBeenCalledExactlyOnceWith({ reuseExisting: true });
    expect(controller.getSnapshot().selected).toBe(thread.id);
    expect(controller.getSnapshot().connection).toBe("ready");
    controller.dispose();
  });

  it("stops the browser subscription while hidden and reloads the selected thread on return", async () => {
    const controller = new GuiController();
    await controller.connect();
    await controller.select(thread.id);
    const stop = await vi.mocked(guiApi.subscribe).mock.results[0].value;
    controller.suspend();
    expect(stop).toHaveBeenCalledOnce();
    await controller.connect();
    expect(guiApi.subscribe).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("starts a conversation without a selected project and keeps scratch folders out of recent projects", async () => {
    const controller = new GuiController();
    await controller.connect();
    vi.mocked(guiApi.request).mockImplementation(async (request) => {
      if (request.operation === "list") return { data: [], nextCursor: null };
      if (request.operation === "send") return { turn: { id: "turn", status: "completed", items: [] } };
      return { thread: { ...thread, cwd: "" } };
    });
    expect(await controller.send("hello", [])).toBe(true);
    expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({ operation: "start", cwd: undefined }));
    expect(controller.getSnapshot().settings.cwd).toBe("");
    expect(controller.getSnapshot().projects).toEqual([]);
  });

  it("remembers a removed project and changes the next turn instead of relying on cached resume settings", async () => {
    const controller = new GuiController();
    await controller.connect();
    await controller.select("one");
    controller.settings({ cwd: thread.cwd });
    controller.setProject("");
    expect(new GuiController().getSnapshot().projectOverrides.one).toBe("");
    vi.mocked(guiApi.request).mockImplementation(async (request) => {
      if (request.operation === "list") return { data: [thread], nextCursor: null };
      if (request.operation === "send") return { turn: { id: "turn", status: "completed", items: [] } };
      return { thread };
    });
    expect(await controller.send("continue", [])).toBe(true);
    expect(guiApi.request).toHaveBeenCalledWith(expect.objectContaining({
      operation: "send", threadId: "one", cwd: "" }));
    await controller.refresh();
    expect(controller.getSnapshot().threads[0].cwd).toBe("");
    expect(controller.getSnapshot().settings.cwd).toBe("");
    expect(controller.getSnapshot().projects).toEqual([thread.cwd]);
  });

  it("batches rapid deltas and flushes them before completion", async () => {
    const controller = new GuiController();
    await controller.connect();
    await controller.select("one");
    const changed = vi.fn();
    controller.subscribe(changed);
    for (let index = 0; index < 100; index += 1) {
      receive({ method: "item/agentMessage/delta", params: {
        threadId: "one", turnId: "turn", itemId: "answer", delta: "a" } });
    }
    expect(changed).not.toHaveBeenCalled();
    receive({ method: "turn/completed", params: { threadId: "one",
      turn: { id: "turn", status: "completed", items: [] } } });
    expect(controller.getSnapshot().conversations.one.turns[0].items[0].text).toBe("a".repeat(100));
    expect(controller.getSnapshot().conversations.one.activeTurn).toBeNull();
    controller.dispose();
  });

  it("ignores a stale history response when the user switches conversations", async () => {
    const controller = new GuiController();
    await controller.connect();
    let resolve!: (value: { thread: Thread }) => void;
    vi.mocked(guiApi.request).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const opening = controller.select("one");
    controller.newConversation();
    resolve({ thread });
    await opening;
    expect(controller.getSnapshot().selected).toBeNull();
    expect(controller.getSnapshot().conversations.one).toBeUndefined();
  });

  it("keeps a fast completed turn completed and submits a double click only once", async () => {
    const controller = new GuiController();
    await controller.connect();
    controller.settings({ cwd: thread.cwd });
    const requests: Request[] = [];
    vi.mocked(guiApi.request).mockImplementation(async (request) => {
      requests.push(request);
      if (request.operation === "send") {
        receive({ method: "turn/completed", params: { threadId: thread.id,
          turn: { id: "turn", status: "completed", items: [{ id: "answer", type: "agentMessage", text: "ok" }] } } });
        return { turn: { id: "turn", status: "inProgress", items: [] } };
      }
      if (request.operation === "list") return { data: [thread], nextCursor: null };
      return { thread };
    });
    const result = controller.send("hello", []);
    expect(await controller.send("hello", [])).toBe(false);
    expect(await result).toBe(true);
    expect(requests.filter((request) => request.operation === "send")).toHaveLength(1);
    expect(controller.getSnapshot().conversations.one.activeTurn).toBeNull();
    expect(controller.getSnapshot().conversations.one.turns[0].status).toBe("completed");
  });

  it("restores the normal list for a new conversation opened from the archive", async () => {
    const controller = new GuiController();
    await controller.connect();
    controller.filter("", true);
    controller.newConversation();
    expect(controller.getSnapshot().archived).toBe(false);
  });

  it("times the outgoing request until the turn starts without reviving it after an early completion", async () => {
    const controller = new GuiController();
    await controller.connect();
    let resolveStart!: (value: unknown) => void;
    let resolveSend!: (value: unknown) => void;
    vi.mocked(guiApi.request).mockImplementation(async (request) => {
      if (request.operation === "start") return new Promise((done) => { resolveStart = done; });
      if (request.operation === "send") return new Promise((done) => { resolveSend = done; });
      return { data: [], nextCursor: null };
    });
    const result = controller.send("hello", []);
    const startedAtMs = controller.getSnapshot().pendingRequest?.startedAtMs;
    expect(startedAtMs).toBeTypeOf("number");
    expect(controller.getSnapshot().pendingRequest?.threadId).toBeNull();
    resolveStart({ thread });
    await vi.waitFor(() => expect(resolveSend).toBeTypeOf("function"));
    expect(controller.getSnapshot().pendingRequest).toEqual({ threadId: thread.id, startedAtMs });
    receive({ method: "turn/started", params: { threadId: thread.id,
      turn: { id: "live", status: "inProgress", items: [] } } });
    expect(controller.getSnapshot().pendingRequest).toBeUndefined();
    expect(controller.getSnapshot().conversations.one.processing?.phase).toBe("request");
    receive({ method: "turn/completed", params: { threadId: thread.id,
      turn: { id: "live", status: "completed", items: [] } } });
    expect(controller.getSnapshot().conversations.one.processing).toBeUndefined();
    resolveSend({ turn: { id: "live", status: "inProgress", items: [] } });
    await result;
    expect(controller.getSnapshot().pendingRequest).toBeUndefined();
    expect(controller.getSnapshot().conversations.one.activeTurn).toBeNull();
    controller.dispose();
  });

  it("clears request timing after failure and resumes the phase after an approval reply", async () => {
    const controller = new GuiController();
    await controller.connect();
    vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("offline"));
    expect(await controller.send("hello", [])).toBe(false);
    expect(controller.getSnapshot().pendingRequest).toBeUndefined();
    await controller.select(thread.id);
    receive({ method: "turn/started", params: { threadId: thread.id,
      turn: { id: "live", status: "inProgress", items: [] } } });
    receive({ method: "item/started", params: { threadId: thread.id, turnId: "live",
      item: { id: "command", type: "commandExecution", status: "inProgress" } } });
    receive({ method: "item/commandExecution/requestApproval", id: 0,
      params: { threadId: thread.id, turnId: "live" } });
    expect(controller.getSnapshot().conversations.one.processing?.phase).toBe("approval");
    await controller.respond({ id: 0, decision: "accept" });
    expect(controller.getSnapshot().conversations.one.processing?.phase).toBe("command");
    controller.dispose();
  });
});
