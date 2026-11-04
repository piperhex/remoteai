// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "../../api/backend";
import { useCoze, type CozeStatus } from "./useCoze";

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), isDesktopApp: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
let root: Root;
let value: ReturnType<typeof useCoze>;
const idle: CozeStatus = { installed: false, version: "0.1.0", phase: "idle", downloaded: 0, total: null, url: null };
function Fixture({ active = true }: { active?: boolean }) { value = useCoze(active); return null; }

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  vi.mocked(invoke).mockResolvedValue(idle);
});
afterEach(async () => {
  await act(async () => root.unmount()); vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it("first entry only checks status, without silently downloading", async () => {
  await act(async () => root.render(<Fixture />));
  expect(invoke).toHaveBeenCalledExactlyOnceWith("coze_status");
  expect(value.status?.installed).toBe(false);
});

it("keeps polling single-flight and stops polling when inactive", async () => {
  let resolve!: (status: CozeStatus) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise((finish) => { resolve = finish; }));
  await act(async () => root.render(<Fixture />));
  await act(async () => vi.advanceTimersByTime(4000));
  expect(invoke).toHaveBeenCalledTimes(1);
  await act(async () => resolve(idle));
  await act(async () => vi.advanceTimersByTime(1000));
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => root.render(<Fixture active={false} />));
  await act(async () => vi.advanceTimersByTime(5000));
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("reports installation failures and allows a deliberate retry", async () => {
  await act(async () => root.render(<Fixture />));
  vi.mocked(invoke).mockRejectedValueOnce("下载未完成");
  await act(async () => value.install());
  expect(value.error).toContain("下载未完成");
  expect(value.busy).toBe(false);
  vi.mocked(invoke).mockResolvedValueOnce({ ...idle, installed: true, url: "http://127.0.0.1:1234/" });
  await act(async () => value.install());
  expect(value.error).toBe("");
  expect(value.status?.url).toBe("http://127.0.0.1:1234/");
});

it("an old status reply cannot erase a newly installed session", async () => {
  let finish!: (status: CozeStatus) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Fixture />));
  vi.mocked(invoke).mockResolvedValueOnce({ ...idle, installed: true, url: "http://127.0.0.1:4321/" });
  await act(async () => value.install());
  await act(async () => finish(idle));
  expect(value.status?.url).toBe("http://127.0.0.1:4321/");
});
