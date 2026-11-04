// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { guiApi } from "../../../../../shared/conversation/api";
import { GuiController } from "./controller";
import { initialState } from "./preferences";
import type { GuiEvent, Thread } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { connect: vi.fn(), request: vi.fn(), subscribe: vi.fn() } }));
const thread: Thread = { id: "one", cwd: "D:/project", preview: "hello", updatedAt: 1, turns: [] };
let controller: GuiController;
let receive: (event: GuiEvent) => void;
const complete = (id = "turn") => receive({ method: "turn/completed", params: { threadId: thread.id,
  turn: { id, status: "completed", items: [] } } });

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(guiApi.connect).mockResolvedValue([]);
  vi.mocked(guiApi.subscribe).mockImplementation(async (listener) => { receive = listener; return vi.fn<() => void>(); });
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === "list") return { data: [thread], nextCursor: null };
    if (request.operation === "models") return { data: [], nextCursor: null };
    if (request.operation === "goalGet") return { goal: null };
    return { thread };
  });
  controller = new GuiController();
  controller.readState.setViewing(true);
  await controller.connect();
});

it("marks an unloaded background conversation unread, persists it, and clears it only after opening", async () => {
  complete();
  expect(initialState().threadReadState.one).toEqual({ turnId: "turn", unread: true });
  await controller.refresh();
  expect(controller.getSnapshot().threadReadState.one.unread).toBe(true);
  await controller.select("one");
  expect(initialState().threadReadState.one.unread).toBe(false);
  controller.newConversation();
  complete();
  expect(controller.getSnapshot().threadReadState.one.unread).toBe(false);
  complete("next");
  expect(controller.getSnapshot().threadReadState.one.unread).toBe(true);
  controller.dispose();
});

it("keeps a visible conversation read but marks a completion received while hidden unread", async () => {
  await controller.select("one");
  complete();
  expect(controller.getSnapshot().threadReadState.one.unread).toBe(false);
  controller.readState.setViewing(false);
  complete("background");
  expect(controller.getSnapshot().threadReadState.one.unread).toBe(true);
  await controller.select("one");
  expect(controller.getSnapshot().threadReadState.one.unread).toBe(true);
  controller.readState.setViewing(true);
  expect(initialState().threadReadState.one.unread).toBe(false);
  controller.dispose();
});

it("keeps failed loads unread and clears stale running status immediately on completion", async () => {
  receive({ method: "turn/started", params: { threadId: "one",
    turn: { id: "turn", status: "inProgress", items: [] } } });
  expect(controller.getSnapshot().threads[0].status?.type).toBe("active");
  complete();
  expect(controller.getSnapshot().threads[0].status?.type).toBe("idle");
  vi.mocked(guiApi.request).mockRejectedValueOnce(new Error("offline"));
  await controller.select("one");
  expect(controller.getSnapshot().threadReadState.one.unread).toBe(true);
  controller.dispose();
});

it("restores only valid unread records from preferences", () => {
  localStorage.setItem("codex-switch:gui", JSON.stringify({ threadReadState: {
    one: { turnId: "turn", unread: true }, invalid: { turnId: 1, unread: "yes" }, empty: null,
  } }));
  expect(initialState().threadReadState).toEqual({ one: { turnId: "turn", unread: true } });
  controller.dispose();
});

it("detects a reply completed while the browser subscription was suspended", async () => {
  receive({ method: "turn/started", params: { threadId: "one",
    turn: { id: "turn", status: "inProgress", items: [] } } });
  controller.readState.setViewing(false);
  controller.suspend();
  await controller.connect();
  expect(controller.getSnapshot().threads[0].status?.type).not.toBe("active");
  expect(initialState().threadReadState.one.unread).toBe(true);
  controller.dispose();
});
