import { expect, it } from "vitest";
import { queuedMessageText } from "../../../../../shared/conversation/queuedMessageDraft";

it("restores repeated skills without confusing names that share a prefix", () => {
  const skills = ["review", "review-code", "review.code"].map((name) => ({ name, path: `D:/skills/${name}` }));
  const text = "$review-code $review $review.code $review";
  const restored = queuedMessageText({ text, skills, images: [] });
  expect(restored.text).toBe(text);
  expect(restored.mentions.map(({ start, end, skill }) => [text.slice(start, end), skill.path])).toEqual([
    ["$review-code", skills[1].path], ["$review", skills[0].path],
    ["$review.code", skills[2].path], ["$review", skills[0].path],
  ]);
});

it("makes skills without text labels visible so they can be edited and resent", () => {
  const skill = { name: "review", path: "D:/skills/review" };
  const restored = queuedMessageText({ text: "", skills: [skill], images: [] });
  expect(restored.text).toBe("$review");
  expect(restored.mentions).toMatchObject([{ start: 0, end: 7, skill }]);
});
