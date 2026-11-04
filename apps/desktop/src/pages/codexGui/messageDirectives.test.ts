import { expect, it } from "vitest";
import { messageSections } from "../../../../../shared/conversation/messageDirectives";

const directive = '::code-comment{title="[P2] 空输入" body="先检查输入。" file="F:/demo/file.ts" start="3" end="5"}';
it("renders valid review comments between Markdown sections", () => {
  expect(messageSections(`说明\n${directive}\n结尾`)).toEqual([
    { type: "markdown", text: "说明" },
    { type: "review", comment: { title: "[P2] 空输入", body: "先检查输入。", file: "F:/demo/file.ts", start: 3, end: 5 } },
    { type: "markdown", text: "结尾" },
  ]);
});
it("keeps code examples and incomplete streamed directives as text", () => {
  const fenced = `\`\`\`text\n${directive}\n\`\`\``;
  expect(messageSections(fenced)).toEqual([{ type: "markdown", text: fenced }]);
  expect(messageSections('::code-comment{title="待完成"')).toEqual([
    { type: "markdown", text: '::code-comment{title="待完成"' },
  ]);
});
