// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerAddMenu } from "./ComposerAddMenu";
import { SkillInput, type SkillInputHandle } from "./SkillInput";
import { useComposerDraft } from "./useComposerDraft";
import { GuiController } from "./controller";
import { guiApi } from "../../../../../shared/conversation/api";
import { readEditor } from "./skillEditorDom";
import type { Skill } from "../../../../../shared/conversation/types";

vi.mock("../../../../../shared/conversation/api", () => ({ guiApi: { request: vi.fn() } }));
const icon = "data:image/svg+xml;base64,PHN2Zy8+";
const skill: Skill = { name: "review", path: "D:/skills/review/SKILL.md", enabled: true,
  description: "检查代码", iconUrl: icon, interface: { displayName: "Review" } };
const controller = new GuiController();
let root: Root;
let host: HTMLDivElement;
function Fixture({ cwd = "D:/project", disabled = false }: { cwd?: string; disabled?: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<SkillInputHandle>(null);
  const draft = useComposerDraft(cwd, controller);
  return <div ref={anchor}>
    <SkillInput ref={input} value={draft.draft} draftKey={cwd} cwd={cwd} active connected disabled={disabled}
      compact={{ enabled: false, description: "开始对话后即可压缩", percent: null, run: vi.fn() }}
      placeholder="输入消息" onChange={draft.editContent} onPaste={draft.paste} onSend={() => void draft.send()} />
    <ComposerAddMenu cwd={cwd} disabled={disabled} active anchor={anchor} onFiles={vi.fn()} onGoal={vi.fn()}
      onPlugin={(plugin) => draft.addAttachments([plugin])} onSkill={(value) => input.current?.addSkill(value)} />
  </div>;
}
const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="添加"]')!;
const editor = () => host.querySelector<HTMLDivElement>('[role="textbox"]')!;
const panel = () => document.getElementById(trigger().getAttribute("aria-describedby") ?? "")!;
const click = async (button: HTMLElement) => act(async () => button.click());
const open = () => click(trigger());
const render = (cwd?: string, disabled?: boolean) => act(async () => root.render(<Fixture cwd={cwd} disabled={disabled} />));

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(controller, "send").mockResolvedValue(true);
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "skills"
    ? { data: [{ skills: [skill, { ...skill, name: "disabled", path: "disabled", enabled: false }], errors: [] }] }
    : { marketplaces: [], marketplaceLoadErrors: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("lists skills with their icons even when no plugins are installed and sends the selected reference", async () => {
  expect(guiApi.request).not.toHaveBeenCalled();
  await open();
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "skills", cwd: "D:/project" });
  expect(panel().textContent).toContain("Review");
  expect(panel().querySelector("img")?.getAttribute("src")).toBe(icon);
  expect(panel().querySelectorAll("button:disabled")).toHaveLength(1);
  const button = Array.from(panel().querySelectorAll("button")).find((item) => item.textContent === "Review检查代码")!;
  await click(button);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(editor());
  expect(readEditor(editor()).mentions[0].skill.path).toBe(skill.path);
  await act(async () => editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(controller.send).toHaveBeenCalledWith("$review ", [], [{ name: skill.name, path: skill.path }]);
});

it("preserves the caret and surrounding draft when selecting a skill from the menu", async () => {
  await act(async () => {
    editor().textContent = "请检查 这里";
    editor().focus();
    const range = document.createRange();
    range.setStart(editor().firstChild!, 4);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    editor().dispatchEvent(new InputEvent("input", { bubbles: true }));
    trigger().focus();
  });
  await open();
  await click(Array.from(panel().querySelectorAll("button")).find((item) => item.textContent === "Review检查代码")!);
  expect(readEditor(editor()).text).toBe("请检查 $review 这里");
  expect(readEditor(editor()).mentions[0].start).toBe(4);
  expect(controller.send).not.toHaveBeenCalled();
});

it("keeps skills available when plugin loading fails and retries skill failures on reopen", async () => {
  let failing: "skills" | "plugins" | null = "plugins";
  vi.mocked(guiApi.request).mockImplementation(async (request) => {
    if (request.operation === failing) throw new Error("unavailable");
    return request.operation === "skills" ? { data: [{ skills: [skill], errors: [] }] }
      : { marketplaces: [], marketplaceLoadErrors: [] };
  });
  await open();
  expect(panel().textContent).toContain("Review");
  expect(panel().textContent).toContain("插件暂时无法加载");
  await click(trigger());
  failing = "skills";
  await open();
  expect(panel().textContent).toContain("技能加载失败");
  await click(trigger());
  failing = null;
  await open();
  expect(panel().textContent).toContain("Review");
});

it("closes on project changes and ignores results from the previous project", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(guiApi.request).mockImplementation(async (request) => request.operation === "skills"
    ? new Promise((done) => { resolve = done; }) : { marketplaces: [], marketplaceLoadErrors: [] });
  await open();
  const resolvePrevious = resolve;
  await render("D:/other");
  await act(async () => resolvePrevious({ data: [{ skills: [skill], errors: [] }] }));
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  await open();
  expect(panel().textContent).not.toContain("Review");
  expect(guiApi.request).toHaveBeenCalledWith({ operation: "skills", cwd: "D:/other" });
  await render("D:/other", true);
  expect(trigger().disabled).toBe(true);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});
