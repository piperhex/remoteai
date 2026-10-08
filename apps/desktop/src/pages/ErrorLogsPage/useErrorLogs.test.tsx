// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearErrorLogs, listErrorLogs, type ErrorLogPage } from "../../api/errorLogs";
import { useErrorLogs } from "./useErrorLogs";

vi.mock("../../api/errorLogs", () => ({ listErrorLogs: vi.fn(), clearErrorLogs: vi.fn() }));
type Pending = { resolve: (page: ErrorLogPage) => void; reject: (error: Error) => void };
let requests: Pending[];
let root: Root;
let container: HTMLDivElement;
let logs: ReturnType<typeof useErrorLogs>;
let renders: number;

function Probe() { logs = useErrorLogs(); renders += 1; return null; }
function page(ids: number[], current = 1, total = 35): ErrorLogPage {
  return { entries: ids.map(id => ({ id, createdAt: "2026-09-23T12:00:00Z", source: "proxy", message: `日志 ${id}` })),
    page: current, total, snapshotId: 35, hasMore: current * 10 < total };
}
const finish = async (index: number, result: ErrorLogPage) => act(async () => requests[index].resolve(result));

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  requests = [];
  renders = 0;
  vi.mocked(listErrorLogs).mockImplementation(() => new Promise((resolve, reject) => requests.push({ resolve, reject })));
  vi.mocked(clearErrorLogs).mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Probe />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("requests one visible page and keeps polling single-flight", async () => {
  expect(listErrorLogs).toHaveBeenLastCalledWith({ limit: 10, source: undefined,
    pagination: { page: 1, snapshotId: null } });
  await act(async () => vi.advanceTimersByTime(6_000));
  expect(requests).toHaveLength(1);
  await finish(0, page([35, 34]));
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(requests).toHaveLength(2);
});

it("filters Codex installation diagnostics and retains the filter while polling", async () => {
  await finish(0, page([35]));
  await act(async () => logs.setFilter("codex"));
  expect(listErrorLogs).toHaveBeenLastCalledWith({ limit: 10, source: "codex",
    pagination: { page: 1, snapshotId: null } });
  const result: ErrorLogPage = { ...page([36], 1, 1), entries: [{ id: 36,
    createdAt: "2026-09-23T12:00:00Z", source: "codex", message: "Codex CLI [extract]: os error 32" }] };
  await finish(1, result);
  expect(logs.entries[0].source).toBe("codex");
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(listErrorLogs).toHaveBeenLastCalledWith({ limit: 10, source: "codex",
    pagination: { page: 1, snapshotId: null } });
});

it("anchors historical pages and resumes live polling on page one", async () => {
  await finish(0, page([35, 34]));
  await act(async () => logs.changePage(2, 10));
  expect(listErrorLogs).toHaveBeenLastCalledWith({ limit: 10, source: undefined,
    pagination: { page: 2, snapshotId: 35 } });
  await finish(1, page([25, 24], 2));
  await act(async () => vi.advanceTimersByTime(8_000));
  expect(requests).toHaveLength(2);
  expect(logs.entries.map(entry => entry.id)).toEqual([25, 24]);
  await act(async () => logs.changePage(1, 10));
  await finish(2, page([36, 35]));
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(requests).toHaveLength(4);
});

it("queues the latest navigation behind an active poll without applying stale data", async () => {
  await finish(0, page([35, 34]));
  await act(async () => vi.advanceTimersByTime(2_000));
  await act(async () => logs.changePage(2, 10));
  await act(async () => logs.setFilter("toast"));
  expect(requests).toHaveLength(2);
  await finish(1, page([36, 35]));
  expect(logs.entries).toEqual([]);
  expect(listErrorLogs).toHaveBeenLastCalledWith({ limit: 10, source: "toast",
    pagination: { page: 1, snapshotId: null } });
  await finish(2, page([30], 1, 1));
  expect(logs.filter).toBe("toast");
  expect(logs.entries[0].id).toBe(30);
});

it("page-size changes and manual refresh return to the newest page", async () => {
  await finish(0, page([35, 34]));
  await act(async () => logs.changePage(2, 10));
  await finish(1, page([25, 24], 2));
  await act(async () => logs.changePage(2, 20));
  expect(logs.page).toBe(1);
  expect(listErrorLogs).toHaveBeenLastCalledWith({ limit: 20, source: undefined,
    pagination: { page: 1, snapshotId: null } });
  await finish(2, page([35, 34]));
  await act(async () => logs.refresh());
  expect(logs.pageSize).toBe(20);
  expect(requests).toHaveLength(4);
});

it("accepts a clamped last page and recovers from a failed page load", async () => {
  await finish(0, page([35, 34]));
  await act(async () => logs.changePage(4, 10));
  await act(async () => requests[1].reject(new Error("unavailable")));
  expect(logs.error).toBe("load");
  expect(logs.operation).toBeNull();
  await act(async () => logs.changePage(4, 10));
  await finish(2, page([15], 2, 11));
  expect(logs.page).toBe(2);
  expect(logs.total).toBe(11);
  expect(logs.error).toBeNull();
});

it("pauses refresh during confirmation and resets pagination after clearing", async () => {
  await finish(0, page([35, 34]));
  logs.setPollingPaused(true);
  await act(async () => vi.advanceTimersByTime(4_000));
  expect(requests).toHaveLength(1);
  await act(async () => logs.changePage(2, 10));
  await finish(1, page([25, 24], 2));
  await act(async () => logs.clear());
  expect(clearErrorLogs).toHaveBeenCalledTimes(1);
  expect(logs.page).toBe(1);
  expect(logs.total).toBe(0);
  expect(logs.entries).toEqual([]);
});

it("stops timers and ignores an outstanding response after unmounting", async () => {
  await act(async () => root.render(null));
  const previousRenders = renders;
  await finish(0, page([35]));
  await act(async () => vi.advanceTimersByTime(6_000));
  expect(renders).toBe(previousRenders);
  expect(requests).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
