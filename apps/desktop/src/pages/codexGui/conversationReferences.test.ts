import { expect, it } from "vitest";
import { conversationCandidates, conversationReference, referenceKind } from "../../../../../shared/conversation/conversationReferences";
import { remoteAttachments } from "../../../../../shared/remote-chat/composerAttachments";
import { conversation } from "../../../../../shared/conversation/events";
import type { Thread } from "../../../../../shared/conversation/types";

it("keeps duplicate titles distinct, excludes self and prefers live running state", () => {
  const first: Thread = { id: "one", name: "同名", preview: "", cwd: "D:/one", updatedAt: 1 };
  const second: Thread = { ...first, id: "two", cwd: "D:/two", status: { type: "active" } };
  const current = { ...first, id: "current" };
  const candidates = conversationCandidates({ remote: [first, second, current], known: [], query: "",
    currentId: "current", conversations: { one: { ...conversation(first), activeTurn: "running" },
      two: { ...conversation(second), activeTurn: null } } });
  expect(candidates.map((value) => [value.id, value.status?.type])).toEqual([["one", "active"], ["two", "idle"]]);
  expect(candidates.map(conversationReference).map((value) => value.path))
    .toEqual(["codex-thread://one", "codex-thread://two"]);
});

it("validates conversation references through remote transport and restores their kind", () => {
  const reference = conversationReference({ id: "source", preview: "多行\n名称", cwd: "", updatedAt: 0 });
  expect(reference.name).toBe("多行 名称");
  expect(remoteAttachments([reference])).toEqual([reference]);
  expect(referenceKind(reference.path)).toBe("conversation");
  for (const path of ["codex-thread://", "codex-thread://../secret", "codex-thread://bad\\path"]) {
    expect(() => remoteAttachments([{ ...reference, path }])).toThrow();
  }
  expect(() => remoteAttachments([{ ...reference, data: "eA==" }])).toThrow();
});
