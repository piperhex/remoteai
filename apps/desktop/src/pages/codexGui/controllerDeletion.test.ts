// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { GuiController } from "./controller";
import { guiApi } from "../../../../../shared/conversation/api";
import { deleteGuiThread } from "./deleteThread";
import type { GuiEvent, Thread } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
vi.mock("./deleteThread", () => ({ deleteGuiThread: vi.fn() }));
const thread: Thread = { id: "one", cwd: "D:/project", preview: "hello", updatedAt: 1, turns: [] };
let receive: (event: GuiEvent) => void;
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(deleteGuiThread).mockResolvedValue({ requestedCount: 1, affectedCount: 1,
    releasedBytes: 0, message: "done", deletedThreadIds: [thread.id] });
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (callback) => { receive = callback; return () => {}; });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list" || request.operation === "models") return { data: [], nextCursor: null };
    return { thread };
  });
});

it("removes deleted selection, cached messages and pins, and ignores late thread events", async () => {
  const controller = new GuiController();
  await controller.connect(); await controller.select(thread.id); controller.pin(thread.id);
  expect(await controller.deleteThread(thread.id)).toBe(true);
  receive({ method: "thread/started", params: { thread } });
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().conversations[thread.id]).toBeUndefined();
  expect(controller.getSnapshot().pins).toEqual([]);
  expect(new GuiController().getSnapshot().selected).toBeNull();
  controller.dispose();
});

it("keeps selection and messages when deleting fails", async () => {
  const controller = new GuiController();
  await controller.connect(); await controller.select(thread.id);
  vi.mocked(deleteGuiThread).mockRejectedValue(new Error("retry"));
  expect(await controller.deleteThread(thread.id)).toBe(false);
  expect(controller.getSnapshot().selected).toBe(thread.id);
  expect(controller.getSnapshot().conversations[thread.id].thread).toEqual(thread);
  expect(controller.getSnapshot().deleting).toBeUndefined();
  controller.dispose();
});

it("removes all returned descendants including a selected child without relying on events", async () => {
  const child = { ...thread, id: "child" };
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "read") return { thread: request.threadId === "child" ? child : thread };
    return { data: [], nextCursor: null };
  });
  const controller = new GuiController();
  await controller.connect();
  await controller.select(thread.id); controller.pin(thread.id);
  await controller.select(child.id); controller.pin(child.id);
  vi.mocked(deleteGuiThread).mockResolvedValue({ requestedCount: 1, affectedCount: 2,
    releasedBytes: 0, message: "done", deletedThreadIds: [thread.id, child.id] });
  expect(await controller.deleteThread(thread.id)).toBe(true);
  receive({ method: "thread/started", params: { thread: child } });
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().conversations).toEqual({});
  expect(controller.getSnapshot().pins).toEqual([]);
  controller.dispose();
});

it("removes a conversation deleted from another connected GUI", async () => {
  const controller = new GuiController();
  await controller.connect(); await controller.select(thread.id);
  receive({ method: "thread/deleted", params: { threadId: thread.id } });
  expect(controller.getSnapshot().selected).toBeNull();
  expect(controller.getSnapshot().conversations[thread.id]).toBeUndefined();
  controller.dispose();
});

it("blocks duplicate deletion and sending until deletion completes", async () => {
  const controller = new GuiController();
  await controller.connect(); await controller.select(thread.id);
  let complete!: () => void;
  vi.mocked(deleteGuiThread).mockReturnValue(new Promise((resolve) => {
    complete = () => resolve({ requestedCount: 1, affectedCount: 1,
      releasedBytes: 0, message: "done", deletedThreadIds: [thread.id] });
  }));
  const deleting = controller.deleteThread(thread.id);
  expect(await controller.deleteThread(thread.id)).toBe(false);
  expect(await controller.send("new turn", [])).toBe(false);
  expect(deleteGuiThread).toHaveBeenCalledOnce();
  complete();
  expect(await deleting).toBe(true);
  controller.dispose();
});

it("prevents deleting while a reply or queued message is pending", async () => {
  const controller = new GuiController();
  await controller.connect(); await controller.select(thread.id);
  receive({ method: "turn/started", params: { threadId: thread.id,
    turn: { id: "live", status: "inProgress", items: [] } } });
  expect(await controller.deleteThread(thread.id)).toBe(false);
  controller.queue.enqueue(thread.id, { text: "next", images: [], skills: [] });
  receive({ method: "turn/completed", params: { threadId: thread.id,
    turn: { id: "live", status: "completed", items: [] } } });
  expect(await controller.deleteThread(thread.id)).toBe(false);
  expect(deleteGuiThread).not.toHaveBeenCalled();
  controller.dispose();
});
