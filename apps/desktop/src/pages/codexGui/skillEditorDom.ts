import type { ComposerText, Skill } from "../../../../../shared/conversation/types";
import styles from "./SkillInput.module.less";
import { skillLabel } from "../../../../../shared/remote-chat/skills";

export { skillLabel, skillDescription } from "../../../../../shared/remote-chat/skills";

export function readEditor(root: Node): ComposerText {
  const value: ComposerText = { text: "", mentions: [] };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { value.text += node.textContent ?? ""; return; }
    if (!(node instanceof HTMLElement)) { node.childNodes.forEach(visit); return; }
    if (node.dataset.skill) {
      const skill: Skill = JSON.parse(node.dataset.skill);
      const start = value.text.length;
      value.text += `$${skill.name}`;
      value.mentions.push({ start, end: value.text.length, skill });
      return;
    }
    if (node.tagName === "BR") {
      // Chromium adds a final BR solely to keep an empty line editable.
      if (!node.nextSibling && (!node.previousSibling || node.previousSibling.nodeName === "BR")) return;
      value.text += "\n";
      return;
    }
    if ((node.tagName === "DIV" || node.tagName === "P") && node.previousSibling) value.text += "\n";
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return value;
}

export function skillNode(skill: Skill) {
  const node = document.createElement("span");
  node.className = styles.skillChip;
  node.setAttribute("contenteditable", "false");
  // Inline references do not need to duplicate potentially large embedded catalog icons.
  node.dataset.skill = JSON.stringify({ ...skill, iconUrl: undefined });
  node.textContent = skillLabel(skill);
  node.setAttribute("aria-label", `Skill：${skillLabel(skill)}`);
  return node;
}

export function writeEditor(root: HTMLElement, value: ComposerText) {
  const nodes: Node[] = [];
  let position = 0;
  for (const mention of value.mentions) {
    nodes.push(document.createTextNode(value.text.slice(position, mention.start)), skillNode(mention.skill));
    position = mention.end;
  }
  nodes.push(document.createTextNode(value.text.slice(position)));
  root.replaceChildren(...nodes);
}

export interface SkillTrigger { query: string; range: Range; kind?: "skill" | "conversation" | "coze" | "file" | "ssh" }

export function skillTrigger(root: HTMLElement): SkillTrigger | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!root.contains(caret.startContainer) || caret.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const before = caret.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(caret.startContainer, caret.startOffset);
  const text = readEditor(before.cloneContents()).text;
  const match = text.match(/(?:^|\s)(!)([^\s!]*)$/u)
    ?? text.match(/(?:^|\s)(%)([^\s%]*)$/u) ?? text.match(/(?:^|\s)([/@#])([^\s/@#]*)$/u);
  if (!match) return null;
  const start = caret.startOffset - match[2].length - 1;
  if (start < 0 || caret.startContainer.parentElement?.closest("[data-skill]")) return null;
  const range = caret.cloneRange();
  range.setStart(caret.startContainer, start);
  const kinds = { "@": "conversation", "#": "coze", "/": "skill", "%": "file", "!": "ssh" } as const;
  return { query: match[2], range, kind: kinds[match[1] as keyof typeof kinds] };
}

export function insertSkill(trigger: SkillTrigger, skill: Skill) {
  const { range } = trigger;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  // The HTML is generated from DOM nodes with escaped attributes/text, never pasted markup.
  // Native insertion keeps selecting a Skill in the same undo history as ordinary typing.
  if (document.execCommand?.("insertHTML", false, `${skillNode(skill).outerHTML}&nbsp;`)) return;
  range.deleteContents();
  const space = document.createTextNode(" ");
  const fragment = document.createDocumentFragment();
  fragment.append(skillNode(skill), space);
  range.insertNode(fragment);
  range.setStartAfter(space);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
