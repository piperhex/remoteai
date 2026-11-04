// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCodexThreadBin, restoreCodexThreads } from "../../api/backend";
import { useTrash } from "./useTrash";
import { threadCopy } from "@remoteai/i18n/copy/desktop/threads";

vi.mock("../../components/CodexHomeScope", () => ({ useSelectedCodexHome: () => "codex-gui" }));
vi.mock("../../api/backend", () => ({ loadCodexThreadBin: vi.fn(), restoreCodexThreads: vi.fn() }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let root: Root;
let trash: ReturnType<typeof useTrash>;
const reportError = vi.fn();
const refresh = vi.fn(async () => {});
function Harness() {
  trash = useTrash({ selected: new Set(), clearSelection: vi.fn(), text: threadCopy.zh,
    notify: vi.fn(), reportError, refresh, setBusy: vi.fn() });
  return <span>{trash.targetHomeId}</span>;
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadCodexThreadBin).mockResolvedValue([
    { sessionId: "one", title: "Conversation", cwd: "D:/project", deletedAt: 0, sizeBytes: 100 },
  ]);
  vi.mocked(restoreCodexThreads).mockResolvedValue({
    requestedCount: 1, affectedCount: 1, releasedBytes: 0, message: "已恢复 1 条会话",
  });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("restores to the chosen home while reloading the original home's recycle bin", async () => {
  await act(async () => trash.openBin());
  await act(async () => { trash.setSelected(new Set(["one"])); trash.setTargetHomeId("default"); });
  await act(async () => trash.restore());
  expect(restoreCodexThreads).toHaveBeenCalledWith(["one"], "codex-gui", "default");
  expect(loadCodexThreadBin).toHaveBeenLastCalledWith("codex-gui");
  expect(trash.selected.size).toBe(0);
  expect(refresh).toHaveBeenCalledOnce();
});

it("keeps the selection and backup visible after a failed restore", async () => {
  await act(async () => trash.openBin());
  await act(async () => trash.setSelected(new Set(["one"])));
  vi.mocked(restoreCodexThreads).mockRejectedValue(new Error("unavailable"));
  await act(async () => trash.restore());
  expect(reportError).toHaveBeenCalledOnce();
  expect(trash.selected.has("one")).toBe(true);
  expect(trash.entries).toHaveLength(1);
});
