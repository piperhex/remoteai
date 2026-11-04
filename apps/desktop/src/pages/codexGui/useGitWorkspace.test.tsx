// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gitApi, type GitStatus } from "../../../../../shared/conversation/gitApi";
import { useGitWorkspace } from "../../../../../shared/conversation/useGitWorkspace";

vi.mock("../../../../../shared/conversation/gitApi", () => ({ gitApi: { request: vi.fn() } }));
let root: Root;
let current: ReturnType<typeof useGitWorkspace>;
const onChange = vi.fn();
const onBusyChange = vi.fn();
const status: GitStatus = { cwd: "F:/project", branch: "main", branches: [{ name: "main", occupied: false }],
  changedFiles: 1, isWorktree: false };
function Fixture() { current = useGitWorkspace({ cwd: status.cwd, onChange, onBusyChange }); return null; }

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(gitApi.request).mockResolvedValue(status);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("loads the branch and changes cwd only after successful worktree creation", async () => {
  expect(current.status?.branch).toBe("main");
  vi.mocked(gitApi.request).mockResolvedValue({ ...status, cwd: "F:/trees/new", isWorktree: true });
  await act(async () => { await current.run({ operation: "createWorktree", cwd: status.cwd, branch: "feature" }); });
  expect(onChange).toHaveBeenCalledWith("F:/trees/new");
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
});

it("prevents overlapping mutations and refreshes while a checkout is pending", async () => {
  let finish!: (value: GitStatus) => void;
  vi.mocked(gitApi.request).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  let pending!: Promise<boolean>;
  await act(async () => { pending = current.run({ operation: "switch", cwd: status.cwd, branch: "next", create: false }); });
  expect(current.busy).toBe(true);
  await act(async () => {
    expect(await current.run({ operation: "switch", cwd: status.cwd, branch: "other", create: false })).toBe(false);
    await current.refresh();
  });
  expect(gitApi.request).toHaveBeenCalledTimes(2);
  await act(async () => { finish({ ...status, branch: "next" }); await pending; });
  expect(current.status?.branch).toBe("next");
  expect(current.busy).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});

it("retains the selected workspace on failure and ignores results after leaving the picker", async () => {
  vi.mocked(gitApi.request).mockRejectedValueOnce("存在冲突");
  await act(async () => { await current.run({ operation: "switch", cwd: status.cwd, branch: "next", create: false }); });
  expect(current.error).toBe("存在冲突");
  expect(current.status?.branch).toBe("main");
  let finish!: (value: GitStatus) => void;
  vi.mocked(gitApi.request).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  let pending!: Promise<boolean>;
  await act(async () => { pending = current.run({ operation: "createWorktree", cwd: status.cwd, branch: "new" }); });
  await act(async () => root.render(null));
  await act(async () => { finish({ ...status, cwd: "F:/trees/new" }); await pending; });
  expect(onChange).not.toHaveBeenCalled();
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});
