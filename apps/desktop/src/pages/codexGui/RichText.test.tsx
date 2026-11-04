// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { markdownAnswer } from "../../../../../shared/chat/markdownFixture.json";
import { answer } from "../../../../../shared/chat/lineBreakFixture.json";
import { RichText } from "../../../../../shared/conversation/RichText";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const render = (text: string) => act(async () => root.render(<RichText text={text} />));

it("keeps all 25 answers and seven model separators on their own lines", async () => {
  await render(answer);
  expect(container.querySelectorAll("br")).toHaveLength(31);
  expect(container.querySelector("p")?.textContent?.replace(/\n/g, "")).toBe(answer.replace(/\n/g, ""));
  expect(container.querySelector("table, ol, ul")).toBeNull();
});

it("preserves soft and explicit breaks without changing code or Markdown blocks", async () => {
  await render("第一行\n**第二行**  \n第三行\\\n第四行\n\n- 条目\n  续行\n\n```text\n甲\n乙\n```");
  expect(container.querySelectorAll("p > br")).toHaveLength(3);
  expect(container.querySelectorAll("li > br")).toHaveLength(1);
  expect(container.querySelector("strong")?.textContent).toBe("第二行");
  expect(container.querySelector("pre")?.textContent).toBe("甲\n乙\n");
  expect(container.querySelector("pre br")).toBeNull();
});

it("renders the reported Chinese answer and boxed result with the shared mobile math rules", async () => {
  await render(markdownAnswer);
  expect(container.querySelectorAll(".katex")).toHaveLength(6);
  expect(container.querySelector(".katex-display .fbox")).not.toBeNull();
  expect(container.querySelector(".katex-display .katex-html")?.textContent).toContain("29");
  expect(container.querySelector(".katex-display .cjk_fallback")?.textContent).toBe("个");
  expect(container.querySelector(".katex-error")).toBeNull();
});

it("supports dollar delimiters and formulas nested in lists and tables", async () => {
  await render("- **行内** $x^2$\n\n| 公式 |\n| --- |\n| $a+b$ |\n\n$$\n\\frac{1}{2}\n$$");
  expect(container.querySelector("li strong")?.textContent).toBe("行内");
  expect(container.querySelector("li .katex")).not.toBeNull();
  expect(container.querySelector("td .katex")).not.toBeNull();
  expect(container.querySelector(".katex-display .mfrac")).not.toBeNull();
});

it("keeps TeX examples in inline, fenced and indented code unchanged", async () => {
  const inline = String.raw`\(x^2\)`;
  const block = String.raw`\[\boxed{29\text{ 个}}\]`;
  const dollars = String.raw`$a$ + $$b$$`;
  await render(`\`${inline}\`\n\n\`\`\`latex\n${block}\n${dollars}\n\`\`\`\n\n    ${block}`);
  expect(container.querySelectorAll(".katex")).toHaveLength(0);
  expect(container.querySelector("code")?.textContent).toBe(inline);
  expect(Array.from(container.querySelectorAll("pre"), node => node.textContent))
    .toEqual([`${block}\n${dollars}\n`, `${block}\n`]);
});

it("keeps streaming partials and invalid formulas readable without enabling unsafe HTML", async () => {
  await render(String.raw`答案：\[\boxed{29`);
  expect(container.textContent).toContain("boxed{29");
  await render(String.raw`答案：\[\boxed{29}\]`);
  expect(container.querySelector(".fbox")).not.toBeNull();
  await render(String.raw`$\invalidcommand{x}$`);
  expect(container.textContent).toContain(String.raw`\invalidcommand{x}`);
  await render(String.raw`\[\href{javascript:alert(1)}{x}\]` + "\n\n<script>alert(1)</script>");
  expect(container.querySelector("script, [href^='javascript:']")).toBeNull();
});
