import { expect, it } from "vitest";
import { editedMessageDraft } from "../../../../../shared/conversation/editedMessageDraft";
import { conversation } from "../../../../../shared/conversation/events";

it("recovers newly pasted images and replaces only the edited message's skills", () => {
  const source = conversation({ id: "thread", cwd: "", preview: "", updatedAt: 0, turns: [
    { id: "last", status: "interrupted", items: [
      { id: "first", type: "userMessage", content: [{ type: "skill", name: "earlier", path: "D:/earlier/SKILL.md" }] },
      { id: "edit", type: "userMessage", content: [{ type: "skill", name: "old", path: "D:/old/SKILL.md" }] },
    ] },
  ] });
  const edit = { threadId: "thread", turnId: "last", itemId: "edit", text: "new text",
    images: ["data:image/png;base64,new"], skills: [{ name: "new", path: "D:/new/SKILL.md" }] };
  expect(editedMessageDraft(source, edit)).toMatchObject({ text: "new text", images: edit.images,
    skills: [{ name: "earlier", path: "D:/earlier/SKILL.md" }, ...edit.skills] });
  expect(editedMessageDraft(source, { ...edit, skills: [] }).skills)
    .toEqual([{ name: "earlier", path: "D:/earlier/SKILL.md" }]);
});

it("recovers the edited text, earlier steering inputs, and all attached references", () => {
  const source = conversation({ id: "thread", cwd: "", preview: "", updatedAt: 0, turns: [
    { id: "last", status: "interrupted", items: [
      { id: "first", type: "userMessage", content: [{ type: "text", text: "earlier input" }] },
      { id: "edit", type: "userMessage", content: [
        { type: "text", text: "old text" }, { type: "localImage", path: "D:/photo.png" },
        { type: "image", url: "data:image/png;base64,aW1hZ2U=" },
        { type: "skill", name: "check", path: "D:/SKILL.md" },
        { type: "mention", name: "file", path: "D:/file.txt" },
        { type: "mention", name: "plugin", path: "plugin://example" },
        { type: "mention", name: "方案", path: "codex-thread://source" },
      ] },
    ] },
  ] });
  expect(editedMessageDraft(source, { threadId: "thread", turnId: "last", itemId: "edit", text: "new text" }))
    .toEqual({ text: "earlier input\n\nnew text", images: ["D:/photo.png", "data:image/png;base64,aW1hZ2U="],
      skills: [{ name: "check", path: "D:/SKILL.md" }], attachments: [
        { kind: "file", name: "file", path: "D:/file.txt" },
        { kind: "plugin", name: "plugin", path: "plugin://example" },
        { kind: "conversation", name: "方案", path: "codex-thread://source" },
      ] });
});

it("does not restore removed images or remove images from earlier steering inputs", () => {
  const source = conversation({ id: "thread", cwd: "", preview: "", updatedAt: 0, turns: [
    { id: "last", status: "interrupted", items: [
      { id: "first", type: "userMessage", content: [{ type: "localImage", path: "D:/earlier.png" }] },
      { id: "edit", type: "userMessage", content: [
        { type: "localImage", path: "D:/remove.png" }, { type: "text", text: "old text" },
        { type: "image", url: "https://example.com/keep.png" },
      ] },
    ] },
  ] });
  expect(editedMessageDraft(source, { threadId: "thread", turnId: "last", itemId: "edit",
    text: "edited", removedImageIndexes: [0] }).images)
    .toEqual(["D:/earlier.png", "https://example.com/keep.png"]);
});
