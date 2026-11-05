// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { guiApi } from "../../../../../shared/conversation/api";
import { watchConversation } from '../../../../../shared/conversation/viewedThreads';

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isHostedWebApp: true, isDesktopApp: false }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock("../../../../../shared/conversation/webEvents", () => ({ subscribeGuiEvent: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('resumes background queues with summaries and keeps content for an explicitly viewed thread', async () => {
  const owner = {};
  vi.mocked(invoke).mockResolvedValue({ data: { thread: { id: 'thread' } } });
  const request = { operation: 'resume' as const, threadId: 'thread', access: 'workspace-write' as const };
  await guiApi.request(request);
  expect(invoke).toHaveBeenLastCalledWith('codex_gui_request', { request: { ...request, summaryOnly: true } });
  await watchConversation(owner, 'thread');
  try {
    await guiApi.request(request);
    expect(invoke).toHaveBeenLastCalledWith('codex_gui_request', { request });
  } finally { await watchConversation(owner, null); }
});

it("sends text and image input through the hosted backend and unwraps the protocol result", async () => {
  const request = { operation: "send" as const, threadId: "host-thread", text: "hello",
    images: ["data:image/png;base64,abc"], access: "danger-full-access" as const };
  vi.mocked(invoke).mockResolvedValue({ data: { turn: { id: "host-turn" } } });
  expect(await guiApi.request(request)).toEqual({ turn: { id: "host-turn" } });
  expect(invoke).toHaveBeenCalledWith("codex_gui_request", { request });
});

it("rejects oversized browser messages before making a request", async () => {
  await expect(guiApi.request({ operation: "send", threadId: "host-thread", text: "",
    images: ["x".repeat(8 * 1024 * 1024)], access: "workspace-write" })).rejects.toThrow("消息太大");
  expect(invoke).not.toHaveBeenCalled();
});

it("routes connection and approval replies to the host", async () => {
  vi.mocked(invoke).mockResolvedValue([]);
  await guiApi.connect();
  await guiApi.respond({ id: 7, decision: "decline" });
  expect(invoke).toHaveBeenCalledWith("codex_gui_connect");
  expect(invoke).toHaveBeenCalledWith("codex_gui_respond", { reply: { id: 7, decision: "decline" } });
});
