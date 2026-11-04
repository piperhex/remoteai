// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TurnMessage } from "./TurnMessage";
import { MessageItem } from "./MessageItem";
import type { Item } from "../../../../../shared/conversation/types";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function toggle(node: HTMLDetailsElement, open = true) {
  await act(async () => { node.open = open; node.dispatchEvent(new Event("toggle")); });
}

it("defers tool screenshots and serialization through each closed layer and releases closed content", async () => {
  const serialize = vi.fn(() => ({ hidden: "structured output" }));
  const serializeInput = vi.fn(() => ({ input: "tool input" }));
  const item: Item = { id: "tool", type: "mcpToolCall", tool: "capture", status: "completed",
    arguments: { toJSON: serializeInput }, result: { content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
      structuredContent: { toJSON: serialize } } };
  await act(async () => root.render(<TurnMessage turn={{ id: "turn", status: "completed", items: [item] }}
    running={false} active />));
  expect(container.querySelectorAll("details")).toHaveLength(1);
  expect(serialize).not.toHaveBeenCalled();
  const group = container.querySelector("details")!;
  await toggle(group);
  const tool = container.querySelectorAll("details")[1];
  expect(container.querySelector("img")).toBeNull();
  expect(serialize).not.toHaveBeenCalled();
  await toggle(tool);
  expect(container.querySelector("img")).not.toBeNull();
  expect(serialize).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("structured output");
  expect(serializeInput).not.toHaveBeenCalled();
  const payload = container.querySelectorAll("details")[2];
  await toggle(payload);
  expect(serializeInput).toHaveBeenCalled();
  expect(container.textContent).toContain("tool input");
  expect(group.open).toBe(true);
  expect(tool.open).toBe(true);
  await toggle(tool, false);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).not.toContain("structured output");
});

it("opens live process groups by default and keeps the user's choice through completion", async () => {
  const turn = { id: "live", status: "inProgress", items: [
    { id: "command", type: "commandExecution", command: "npm test", aggregatedOutput: "PASS" },
  ] };
  const render = (running: boolean) => act(async () => root.render(<TurnMessage turn={turn} running={running} active />));
  await render(true);
  const group = container.querySelector("details")!;
  expect(group.open).toBe(true);
  expect(container.textContent).not.toContain("PASS");
  await toggle(group, false);
  await render(false);
  expect(group.open).toBe(false);
  await toggle(group);
  const command = container.querySelectorAll("details")[1];
  await toggle(command);
  expect(container.textContent).toContain("PASS");
});

it("only serializes an unknown activity when its detail is opened", async () => {
  const serialize = vi.fn(() => "unknown output");
  await act(async () => root.render(<MessageItem streaming={false}
    item={{ id: "unknown", type: "newTool", result: { toJSON: serialize } }} />));
  expect(serialize).not.toHaveBeenCalled();
  await toggle(container.querySelector("details")!);
  expect(container.textContent).toContain("unknown output");
  expect(serialize).toHaveBeenCalledTimes(1);
});
