// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadDashboard } from "../api/backend";
import { DEMO_ACCOUNTS, DEMO_INFO } from "../demo";
import { useAccountDashboard } from "./useAccountDashboard";

vi.mock("../api/backend", () => ({ loadDashboard: vi.fn() }));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));
type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
const snapshot = (label: string): Dashboard => ({
  accounts: DEMO_ACCOUNTS.map(account => ({ ...account, note: label })), info: DEMO_INFO,
});
const notify = vi.fn();
let root: Root;
let dashboard: ReturnType<typeof useAccountDashboard>;

function deferred() {
  let resolve!: (value: Dashboard) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Dashboard>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function Fixture() {
  dashboard = useAccountDashboard(notify);
  useEffect(() => { void dashboard.reload(); }, [dashboard.reload]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("coalesces a burst into one trailing read and resolves callers with the latest snapshot", async () => {
  const first = deferred(), last = deferred();
  vi.mocked(loadDashboard).mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
  await act(async () => root.render(<Fixture />));
  const reads: Promise<Dashboard | undefined>[] = [];
  await act(async () => {
    for (let index = 0; index < 40; index++) reads.push(dashboard.read());
  });
  expect(loadDashboard).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve(snapshot("stale")));
  expect(loadDashboard).toHaveBeenCalledTimes(2);
  expect(dashboard.accounts).toEqual([]);
  const latest = snapshot("latest");
  await act(async () => last.resolve(latest));
  expect(await Promise.all(reads)).toEqual(Array(40).fill(latest));
  expect(dashboard.accounts).toEqual(latest.accounts);
  expect(dashboard.loading).toBe(false);
  expect(loadDashboard).toHaveBeenCalledTimes(2);
});

it("observes changes arriving during the trailing read without overlapping requests", async () => {
  const first = deferred(), second = deferred(), third = deferred();
  vi.mocked(loadDashboard).mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  await act(async () => root.render(<Fixture />));
  void dashboard.reload();
  await act(async () => first.resolve(snapshot("first")));
  void dashboard.reload();
  expect(loadDashboard).toHaveBeenCalledTimes(2);
  await act(async () => second.resolve(snapshot("second")));
  expect(loadDashboard).toHaveBeenCalledTimes(3);
  await act(async () => third.resolve(snapshot("third")));
  expect(dashboard.accounts[0].note).toBe("third");
});

it("does not lose a refresh arriving between the final snapshot and promise settlement", async () => {
  const first = deferred(), second = deferred();
  vi.mocked(loadDashboard).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await act(async () => root.render(<Fixture />));
  let followUp: Promise<Dashboard | undefined> | undefined;
  void first.promise.then(() => queueMicrotask(() => { followUp = dashboard.read(); }));
  await act(async () => first.resolve(snapshot("first")));
  expect(loadDashboard).toHaveBeenCalledTimes(2);
  const latest = snapshot("latest");
  await act(async () => second.resolve(latest));
  expect(await followUp).toEqual(latest);
  expect(dashboard.accounts).toEqual(latest.accounts);
});

it("recovers after a failed read and reports the failure once", async () => {
  vi.mocked(loadDashboard).mockRejectedValueOnce(new Error("unavailable"));
  await act(async () => root.render(<Fixture />));
  expect(notify).toHaveBeenCalledExactlyOnceWith("Error: unavailable");
  expect(dashboard.loading).toBe(false);
  vi.mocked(loadDashboard).mockResolvedValueOnce(snapshot("recovered"));
  await act(async () => dashboard.reload());
  expect(dashboard.accounts[0].note).toBe("recovered");
});

it("does not start queued reads or show late errors after unmount", async () => {
  const pending = deferred();
  vi.mocked(loadDashboard).mockReturnValueOnce(pending.promise);
  await act(async () => root.render(<Fixture />));
  void dashboard.reload();
  await act(async () => root.render(null));
  await act(async () => pending.reject(new Error("late failure")));
  expect(loadDashboard).toHaveBeenCalledTimes(1);
  expect(notify).not.toHaveBeenCalled();
});
