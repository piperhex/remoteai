// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TurnDiff } from "./TurnDiff";
import { gitApi } from "../../../../../shared/conversation/gitApi";
import { changedFiles } from "../../../../../shared/conversation/diff";
import { DetailsContext } from "../../../../../shared/conversation/detailsContext";
import { WorkspaceOperationContext } from "./workspaceOperationContext";

vi.mock("../../../../../shared/conversation/gitApi", () => ({ gitApi: { undo: vi.fn() } }));
vi.mock("antd", () => ({ Popconfirm: ({ children, onConfirm, disabled }: {
  children: ReactNode; onConfirm: () => void; disabled: boolean;
}) => <div onClick={() => { if (!disabled) onConfirm(); }}>{children}</div> }));
const files = changedFiles([{ path: "file.ts", kind: { type: "update" }, diff: "@@ -1 +1 @@\n-old\n+new\n" }]);
let root: Root;
let container: HTMLDivElement;
const setBusy = vi.fn();
function Fixture({ disabled = false }: { disabled?: boolean }) {
  return <WorkspaceOperationContext.Provider value={{ busy: false, setBusy }}>
    <DetailsContext.Provider value={{ open: vi.fn(), update: vi.fn(), close: vi.fn(), visible: false,
      showingChanges: true, openFile: vi.fn(), openWebsite: vi.fn(), setConversationChanges: vi.fn() }}>
      <TurnDiff files={files} title="本轮修改" threadId="thread" turnId="turn" disabled={disabled} />
    </DetailsContext.Provider>
  </WorkspaceOperationContext.Provider>;
}
const button = () => container.querySelector<HTMLButtonElement>('button[aria-label="撤销本轮修改"]')!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); root = createRoot(container);
  vi.mocked(gitApi.undo).mockResolvedValue({ undone: false });
});
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("persists the undone state, prevents a second undo, and keeps review available", async () => {
  await act(async () => root.render(<Fixture />));
  vi.mocked(gitApi.undo).mockResolvedValue({ undone: true });
  await act(async () => button().click());
  expect(gitApi.undo).toHaveBeenLastCalledWith({ threadId: "thread", turnId: "turn" });
  expect(container.textContent).toContain("已撤销 1 个文件");
  expect(button().disabled).toBe(true);
  expect(container.querySelector('button[aria-label^="查看本轮修改"]')).not.toBeNull();
  expect(setBusy.mock.calls).toEqual([[true], [false]]);
  await act(async () => root.render(null));
  await act(async () => root.render(<Fixture />));
  expect(button().disabled).toBe(true);
});

it("blocks undo while running and leaves conflicts retryable", async () => {
  await act(async () => root.render(<Fixture disabled />));
  expect(button().disabled).toBe(true);
  await act(async () => root.render(<Fixture />));
  vi.mocked(gitApi.undo).mockRejectedValueOnce("文件已有其他修改");
  await act(async () => button().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("文件已有其他修改");
  expect(container.textContent).toContain("已编辑 1 个文件");
  expect(button().disabled).toBe(false);
  expect(setBusy).toHaveBeenLastCalledWith(false);
});
