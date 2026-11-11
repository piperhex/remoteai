// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComputerUseStatus } from "../../../api/computerUse";
import { useComputerUse } from "./useComputerUse";

const api = vi.hoisted(() => ({ computerUseStatus: vi.fn(), computerUseAction: vi.fn(),
  requestComputerUsePermission: vi.fn() }));
vi.mock("../../../api/computerUse", () => api);

const installed: ComputerUseStatus = { installed: true, enabled: true, needsRepair: false,
  version: "0.37.0", supported: true, permissions: null };
let root: Root;
let hook: ReturnType<typeof useComputerUse>;
function Harness({ home = "first", active = true }: { home?: string; active?: boolean }) {
  hook = useComputerUse(home, active);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
  api.computerUseStatus.mockResolvedValue(installed);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

it("never overlaps status polling and stops when the card is inactive", async () => {
  let finish!: (status: ComputerUseStatus) => void;
  api.computerUseStatus.mockReturnValue(new Promise<ComputerUseStatus>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(api.computerUseStatus).toHaveBeenCalledTimes(1);
  await act(async () => finish(installed));
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(api.computerUseStatus).toHaveBeenCalledTimes(1);
});

it("does not let a late status response overwrite a completed installation action", async () => {
  let finish!: (status: ComputerUseStatus) => void;
  api.computerUseStatus.mockReturnValue(new Promise<ComputerUseStatus>((resolve) => { finish = resolve; }));
  api.computerUseAction.mockResolvedValue(installed);
  await act(async () => root.render(<Harness />));
  await act(async () => { await hook.run("install"); });
  await act(async () => finish({ ...installed, installed: false, enabled: false }));
  expect(hook.status?.installed).toBe(true);
  expect(api.computerUseAction).toHaveBeenCalledWith("first", "install");
});

it("preserves action errors through polling and clears them on a successful retry", async () => {
  api.computerUseAction.mockRejectedValueOnce("安装未完成").mockResolvedValue(installed);
  await act(async () => root.render(<Harness />));
  await act(async () => { await hook.run("install"); });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(hook.error).toBe("安装未完成");
  await act(async () => { await hook.run("install"); });
  expect(hook.error).toBe("");
});

it("isolates pending status responses when the selected home remounts the card", async () => {
  let finish!: (status: ComputerUseStatus) => void;
  api.computerUseStatus.mockImplementation((home: string) => home === "first"
    ? new Promise<ComputerUseStatus>((resolve) => { finish = resolve; })
    : Promise.resolve({ ...installed, enabled: false }));
  await act(async () => root.render(<Harness key="first" />));
  await act(async () => root.render(<Harness key="second" home="second" />));
  await act(async () => finish(installed));
  expect(hook.status?.enabled).toBe(false);
});

it("requests macOS permissions only after an action and pauses polling while settings open", async () => {
  let finish!: () => void;
  api.requestComputerUsePermission.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(api.requestComputerUsePermission).not.toHaveBeenCalled();
  let pending!: Promise<boolean>;
  await act(async () => { pending = hook.requestPermission("screenRecording"); });
  expect(api.requestComputerUsePermission).toHaveBeenCalledWith("screenRecording");
  const polls = api.computerUseStatus.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(api.computerUseStatus).toHaveBeenCalledTimes(polls);
  expect(hook.busy).toBe(true);
  api.computerUseStatus.mockResolvedValue({ ...installed, permissions: { accessibility: true, screenRecording: true } });
  await act(async () => { finish(); await pending; });
  expect(hook.status?.permissions?.screenRecording).toBe(true);
  expect(hook.busy).toBe(false);
});


it("finishes the initial check in StrictMode without waiting for the polling interval", async () => {
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
  expect(hook.status).toEqual(installed);
  expect(vi.getTimerCount()).toBe(1);
});

it("checks immediately after reactivation while an older request is pending", async () => {
  let finish!: (status: ComputerUseStatus) => void;
  api.computerUseStatus.mockReturnValueOnce(new Promise<ComputerUseStatus>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => root.render(<Harness />));
  await act(async () => finish({ ...installed, needsRepair: true }));
  expect(hook.status).toEqual(installed);
  expect(api.computerUseStatus).toHaveBeenCalledTimes(2);
});

it("does not publish a pending response or queue checks after deactivation", async () => {
  let finish!: (status: ComputerUseStatus) => void;
  api.computerUseStatus.mockReturnValueOnce(new Promise<ComputerUseStatus>((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<Harness active={false} />));
  await act(async () => finish(installed));
  expect(hook.status).toBeNull();
  expect(api.computerUseStatus).toHaveBeenCalledTimes(1);
});

it("keeps declined administrator requests out of the card and refreshes the saved opt-in", async () => {
  const waiting = { ...installed,
    administrator: { requested: true, active: false, inherited: false, attempted: true } };
  await act(async () => root.render(<Harness />));
  api.computerUseAction.mockRejectedValueOnce('UAC cancelled').mockResolvedValueOnce({ ...waiting,
    administrator: { ...waiting.administrator, active: true } });
  api.computerUseStatus.mockResolvedValue(waiting);
  await act(async () => { await hook.run("grantAdministrator"); });
  expect(hook.error).toBe("");
  expect(hook.administratorError).toBe('UAC cancelled');
  expect(hook.status?.administrator?.requested).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(api.computerUseAction).toHaveBeenCalledTimes(1);
  expect(hook.administratorError).toBe('UAC cancelled');
  await act(async () => { await hook.run("grantAdministrator"); });
  expect(hook.administratorError).toBe("");
  expect(hook.status?.administrator?.active).toBe(true);
});
