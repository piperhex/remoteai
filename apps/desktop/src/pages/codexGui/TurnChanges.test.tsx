// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetailsContext } from "../../../../../shared/conversation/detailsContext";
import { TurnMessage } from "./TurnMessage";
import { RunningChangesSummary } from "./RunningChangesSummary";
import type { Conversation, Item, Turn } from "../../../../../shared/conversation/types";

let root: Root;
let container: HTMLDivElement;
const panel = { open: vi.fn(), update: vi.fn(), close: vi.fn(), visible: false, showingChanges: true,
  openFile: vi.fn(), openWebsite: vi.fn(), setConversationChanges: vi.fn() };
const patch = "@@ -1 +1,2 @@\n-old\n+new\n+extra\n";
const netDiff = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
${patch}`;
const edit: Item = { id: "edit", type: "fileChange", status: "completed",
  changes: [{ path: "F:\\project\\src\\example.ts", kind: { type: "update" }, diff: patch }] };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render(items: Item[], extra: Partial<Turn> = {}, previous: Turn[] = []) {
  const turn: Turn = { id: "turn", status: "inProgress", items, ...extra };
  const value: Conversation = { thread: { id: "thread", cwd: "", preview: "", updatedAt: 1 },
    turns: [...previous, turn], activeTurn: turn.status === "inProgress" ? turn.id : null, tokens: 0, error: "" };
  await act(async () => root.render(<DetailsContext.Provider value={panel}>
    <TurnMessage turn={turn} running={turn.status === "inProgress"} active={false} />
    <RunningChangesSummary value={value} />
  </DetailsContext.Provider>));
}

function cards() { return container.querySelectorAll("section[aria-label]"); }
function badge() { return container.querySelector<HTMLButtonElement>('button[aria-label^="查看本轮修改：已编辑"]'); }

it("shows only the final summary when item edits and the net diff describe the same files", async () => {
  await render([edit, { id: "command", type: "commandExecution", command: "npm test", status: "failed" }],
    { diff: netDiff, status: "completed" });
  expect(cards()).toHaveLength(1);
  expect(cards()[0].getAttribute("aria-label")).toBe("本轮修改");
  expect(cards()[0].closest("details")).toBeNull();
  expect(cards()[0].textContent).toContain("src/example.ts");
  expect(cards()[0].textContent).not.toContain("F:");
  expect(cards()[0].textContent).toContain("+2−1");
  await act(async () => (cards()[0].querySelector("button") as HTMLButtonElement).click());
  expect(panel.open).toHaveBeenCalledWith(expect.objectContaining({
    title: "本轮修改", files: [expect.objectContaining({ path: "src/example.ts", raw: netDiff })],
  }));
});

it("updates a compact summary during edits and shows the file list only when the turn finishes", async () => {
  await render([edit]);
  expect(cards()).toHaveLength(0);
  expect(badge()?.textContent).toBe("已编辑 1 个文件+2−1");
  await act(async () => badge()!.click());
  expect(panel.open).toHaveBeenCalledWith(expect.objectContaining({
    title: "本轮修改", files: [expect.objectContaining({ path: "F:\\project\\src\\example.ts" })],
  }));
  const second: Item = { ...edit, id: "second",
    changes: [{ path: "src/other.ts", kind: { type: "add" }, diff: "other" }] };
  await render([edit, second]);
  expect(cards()).toHaveLength(0);
  expect(badge()?.textContent).toBe("已编辑 2 个文件+3−1");
  await render([edit, second], { diff: netDiff });
  expect(cards()).toHaveLength(0);
  expect(badge()?.textContent).toBe("已编辑 1 个文件+2−1");
  expect(panel.update).toHaveBeenLastCalledWith(expect.objectContaining({
    files: [expect.objectContaining({ path: "src/example.ts", raw: netDiff })],
  }));
  await render([edit, second, { id: "answer", type: "agentMessage", phase: "final_answer", text: "完成" }],
    { diff: netDiff, status: "completed" });
  expect(badge()).toBeNull();
  expect(cards()).toHaveLength(1);
  expect(container.querySelector("article")!.compareDocumentPosition(cards()[0])
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("keeps pending, failed, and declined edits as activities without claiming applied changes", async () => {
  await render(["inProgress", "failed", "declined"].map((status) => ({ ...edit, id: status, status })));
  expect(cards()).toHaveLength(0);
  expect(badge()).toBeNull();
  expect(container.textContent).toContain("进行中");
  const group = container.querySelector<HTMLDetailsElement>("[data-activity-group] > details")!;
  await act(async () => { group.open = true; group.dispatchEvent(new Event("toggle")); });
  expect(container.textContent).toContain("失败");
  expect(container.textContent).toContain("已拒绝");
});

it("counts repeated edits to the same path as one file", async () => {
  await render([edit, { ...edit, id: "edit-again" }]);
  expect(badge()?.textContent).toBe("已编辑 1 个文件+4−2");
});

it.each(["interrupted", "failed"])("shows the applied changes as a list after a %s turn", async (status) => {
  await render([edit]);
  await render([edit], { status });
  expect(badge()).toBeNull();
  expect(cards()).toHaveLength(1);
  expect(cards()[0].textContent).toContain("已编辑 1 个文件");
});

it("does not carry earlier changes into a new turn or a conversation without changes", async () => {
  await render([edit]);
  await render([], {}, [{ id: "previous", status: "completed", items: [edit], diff: netDiff }]);
  expect(badge()).toBeNull();
  await render([], { id: "other-conversation-turn" });
  expect(badge()).toBeNull();
});
