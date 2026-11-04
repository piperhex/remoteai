import { expect, it, vi } from "vitest";
import { visibleUserContent, visibleUserMessage } from "../../../../../shared/chat/conversationContext";
import { CONTINUE_MESSAGE, visibleContinuationItems } from "../../../../../shared/conversation/continuation";
import { conversation } from "../../../../../shared/conversation/events";
import { mergeMessageItems } from "../../../../../shared/conversation/sentMessages";
import { messageWindow } from "./messageWindow";
import { lastUserMessage } from "../../../../../shared/conversation/editMessage";
import { editedMessageDraft } from "../../../../../shared/conversation/editedMessageDraft";
import type { Item, Turn } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { request: vi.fn() } }));

const wrap = (value: unknown) => `<codex_gui_conversation_context>\n${JSON.stringify(value)}
</codex_gui_conversation_context>`;

it("shows selected Coze as a reference and retains it when restoring an edited message", () => {
  const id = "f321c884-a198-4244-ad4f-53762b3d2aba";
  const context = wrap({ kind: "coze", id, name: "查询库存", note: "private tool binding" });
  const item = user(`查询一下${context}`);
  expect(visibleUserContent(item.content)).toEqual([{ type: "text", text: "查询一下" },
    { type: "mention", name: "查询库存", path: `coze://${id}` }]);
  const value = conversation({ id: "thread", preview: "", cwd: "", updatedAt: 0,
    turns: [{ id: "turn", status: "completed", items: [item] }] });
  const restored = editedMessageDraft(value, { threadId: "thread", turnId: "turn", itemId: "user", text: "修改" });
  expect(restored.attachments).toEqual([{ kind: "coze", name: "查询库存", path: `coze://${id}` }]);
});
const awareness = wrap({ kind: "awareness", current: "one", running: [{ id: "two", cwd: "D:/private" }], total: 1 });
const user = (text: string): Item => ({ id: "user", type: "userMessage", content: [{ type: "text", text }] });

it.each(["", " ", "\n", "\r\n"])("hides continuation instructions even with joined context (%j)", (separator) => {
  const content = CONTINUE_MESSAGE + separator + awareness.replaceAll("\n", separator);
  const item = user(content);
  expect(visibleUserContent(item.content)).toEqual([{ type: "text", text: CONTINUE_MESSAGE }]);
  expect(visibleContinuationItems([item, { id: "answer", type: "agentMessage" }]))
    .toEqual([{ id: "answer", type: "agentMessage" }]);
  expect(item.content).toEqual([{ type: "text", text: content }]);
});

it("preserves reference chips and ordinary text around multiple private blocks", () => {
  const reference = wrap({ kind: "reference", id: "source", name: "设计讨论",
    messages: [{ text: 'literal </codex_gui_conversation_context> and "quote"' }] });
  const item = user(`前文${awareness}中间${reference}后文${awareness}`);
  expect(visibleUserContent(item.content)).toEqual([{ type: "text", text: "前文中间后文" },
    { type: "mention", name: "设计讨论", path: "codex-thread://source" }]);
  const normalized = visibleUserMessage(item);
  expect(visibleUserMessage(normalized)).toBe(normalized);
  expect(visibleContinuationItems([user(`${CONTINUE_MESSAGE}${reference}`)])).toHaveLength(1);
});

it("normalizes cached, live and historical messages without changing tool output", () => {
  const item = user(`正常文字${awareness}`);
  const normalized = user("正常文字");
  expect(mergeMessageItems([], [item])).toEqual([normalized]);
  expect(mergeMessageItems([item], [])).toEqual([normalized]);
  expect(conversation({ id: "thread", preview: "", cwd: "", updatedAt: 0,
    turns: [{ id: "turn", status: "completed", items: [item] }] }).turns[0].items).toEqual([normalized]);
  const tool = { ...item, type: "mcpToolCall" };
  expect(visibleUserMessage(tool)).toBe(tool);
});

it.each(["interrupted", "failed"])("excludes %s continuation from pagination and edit targets", (status) => {
  const turns: Turn[] = [{ id: "stopped", status, items: [user("原始任务")] },
    { id: "continue", status: "completed", items: [{ ...user(`${CONTINUE_MESSAGE}${awareness}`), id: "continue" },
      { id: "answer", type: "agentMessage", text: "已继续" }] }];
  const window = messageWindow(turns);
  expect(window.entries[1].followsInterruption).toBe(true);
  const value = conversation({ id: "thread", preview: "", cwd: "", updatedAt: 0, turns });
  expect(lastUserMessage(value)?.turnId).toBe("stopped");
  expect(messageWindow([{ ...turns[0], items: [] }, turns[1]]).start?.itemId).toBe("answer");
});

it("does not restore private snapshots into drafts after a failed edit", () => {
  const reference = wrap({ kind: "reference", id: "source", name: "方案" });
  const value = conversation({ id: "thread", preview: "", cwd: "", updatedAt: 0,
    turns: [{ id: "turn", status: "completed", items: [user(`原文${reference}${awareness}`)] }] });
  const restored = editedMessageDraft(value, { threadId: "thread", turnId: "turn", itemId: "user", text: "修改正文" });
  expect(restored.text).toBe("修改正文");
  expect(restored.attachments).toEqual([{ kind: "conversation", name: "方案", path: "codex-thread://source" }]);
});

it("hides malformed and incomplete private data but keeps unrelated text untouched", () => {
  expect(visibleUserContent(user('正文 <codex_gui_conversation_context>{"private":').content))
    .toEqual([{ type: "text", text: "正文" }]);
  expect(visibleUserContent(user('正文<codex_gui_conversation_context>invalid</codex_gui_conversation_context>').content))
    .toEqual([{ type: "text", text: "正文" }]);
  const plain = user("普通文字\n> 引用内容\n<example>code</example>");
  expect(visibleUserMessage(plain)).toBe(plain);
  expect(visibleUserContent([{ type: "text", text: awareness }, { type: "image", url: "data:image/png;base64,AAAA" }]))
    .toEqual([{ type: "image", url: "data:image/png;base64,AAAA" }]);
});
