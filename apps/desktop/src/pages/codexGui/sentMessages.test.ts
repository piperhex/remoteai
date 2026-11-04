import { expect, it } from "vitest";
import { conversation, reduceConversation } from "../../../../../shared/conversation/events";
import { mergeMessageItems, withSentMessage } from "../../../../../shared/conversation/sentMessages";
import type { Item, QueuedMessage, Turn } from "../../../../../shared/conversation/types";

const message: QueuedMessage = { id: "queued", text: "继续检查", images: [], skills: [],
  access: "read-only", model: "", effort: "" };
const turn: Turn = { id: "turn", status: "inProgress", items: [] };
const server: Item = { id: "server", type: "userMessage", content: [{ type: "text", text: message.text }] };

it("preserves the full batch content and puts it before an early assistant reply", () => {
  const answer: Item = { id: "answer", type: "agentMessage", text: "正在检查" };
  const result = withSentMessage({ ...turn, items: [answer] }, [{ ...message,
    images: ["data:image/png;base64,fixture", "D:/picture.png"],
    skills: [{ name: "review", path: "D:/review/SKILL.md" }],
    attachments: [{ kind: "file", name: "notes.txt", path: "D:/notes.txt" }],
  }, { ...message, id: "second", text: "也检查测试" }], 0);
  expect(result.items[0].content).toEqual([
    { type: "text", text: message.text },
    { type: "image", url: "data:image/png;base64,fixture" },
    { type: "localImage", path: "D:/picture.png" },
    { type: "mention", name: "review", path: "D:/review/SKILL.md" },
    { type: "mention", name: "notes.txt", path: "D:/notes.txt" },
    { type: "text", text: "也检查测试" },
  ]);
  expect(result.items[1]).toEqual(answer);
});

it("replaces repeated identical steering messages in order without removing real messages", () => {
  let value = withSentMessage({ ...turn, items: [server] }, [message], 1);
  value = withSentMessage(value, [{ ...message, id: "second" }], 2);
  expect(mergeMessageItems([], value.items)).toEqual(value.items);
  const second = { ...server, id: "second-server" };
  const third = { ...server, id: "third-server" };
  const items = mergeMessageItems(value.items, [second, third, second, third]);
  expect(items.map((item) => item.id)).toEqual([server.id, second.id, third.id]);
  expect(items.some((item) => item.localEcho)).toBe(false);
});

it.each(["item/started", "item/completed", "turn/started", "turn/completed"])(
  "reconciles a local message when %s arrives", (method) => {
    const thread = { id: "one", cwd: "", preview: "", updatedAt: 0, turns: [withSentMessage(turn, [message], 0)] };
    const event = { method, params: { threadId: thread.id, turnId: turn.id, item: server,
      turn: { ...turn, status: method === "turn/completed" ? "completed" : "inProgress", items: [server] } } };
    const value = reduceConversation(reduceConversation(conversation(thread), event), event);
    expect(value.turns[0].items).toEqual([server]);
  },
);

it("reconciles a history refresh and keeps local messages when the snapshot omits items", () => {
  const thread = { id: "one", cwd: "", preview: "", updatedAt: 0, turns: [withSentMessage(turn, [message], 0)] };
  const previous = conversation(thread);
  expect(conversation({ ...thread, turns: [turn] }, previous).turns[0].items).toEqual(previous.turns[0].items);
  expect(conversation({ ...thread, turns: [{ ...turn, items: [server] }] }, previous).turns[0].items).toEqual([server]);
});

it("does not echo a message already delivered before the acknowledgement", () => {
  const received = { ...turn, items: [server] };
  expect(withSentMessage(received, [message], 0)).toBe(received);
});
