// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ invoke: vi.fn(), isDesktopApp: false }));
const native = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("../../api/backend", () => backend);
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock("@tauri-apps/api/event", () => native);
const stops: Array<() => void> = [];
const batch = (sequence: number, events: unknown[] = [], reset = false) =>
  ({ cursor: { streamId: "host", sequence }, events, reset });

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); backend.isDesktopApp = false;
  backend.invoke.mockResolvedValue(batch(0));
});
afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.useRealTimers(); });

it("establishes a cursor before connect, shares polling and delivers ordered GUI and install events", async () => {
  const { subscribeGuiEvent } = await import("../../../../../shared/conversation/webEvents");
  const gui = vi.fn(); const install = vi.fn();
  stops.push(await subscribeGuiEvent("codex-gui-event", gui));
  stops.push(await subscribeGuiEvent("codex-gui-download", install));
  expect(backend.invoke).toHaveBeenCalledTimes(1);
  backend.invoke.mockResolvedValueOnce(batch(2, [
    { name: "codex-gui-event", payload: { method: "turn/started" } },
    { name: "codex-gui-download", payload: { downloaded: 100 } },
  ]));
  await vi.advanceTimersByTimeAsync(250);
  expect(backend.invoke).toHaveBeenLastCalledWith("codex_gui_events", { cursor: batch(0).cursor });
  expect(gui).toHaveBeenCalledWith({ method: "turn/started" });
  expect(install).toHaveBeenCalledWith({ downloaded: 100 });
});

it("keeps slow polls single-flight and ignores their result after unsubscribe", async () => {
  const { subscribeGuiEvent } = await import("../../../../../shared/conversation/webEvents");
  const receive = vi.fn();
  const stop = await subscribeGuiEvent("codex-gui-event", receive);
  stops.push(stop);
  let resolve!: (value: unknown) => void;
  backend.invoke.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await vi.advanceTimersByTimeAsync(5000);
  expect(backend.invoke).toHaveBeenCalledTimes(2);
  stop();
  resolve(batch(1, [{ name: "codex-gui-event", payload: {} }]));
  await vi.advanceTimersByTimeAsync(5000);
  expect(receive).not.toHaveBeenCalled();
  expect(backend.invoke).toHaveBeenCalledTimes(2);
});

it("reports a lost connection and resynchronizes after recovery or a replay gap", async () => {
  const { subscribeGuiEvent } = await import("../../../../../shared/conversation/webEvents");
  const receive = vi.fn();
  stops.push(await subscribeGuiEvent("codex-gui-event", receive));
  backend.invoke.mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(250);
  expect(receive).toHaveBeenLastCalledWith({ method: "connection/closed", params: {} });
  backend.invoke.mockResolvedValueOnce(batch(5, [{ name: "codex-gui-event", payload: "stale" }]));
  await vi.advanceTimersByTimeAsync(1500);
  expect(receive).toHaveBeenLastCalledWith({ method: "connection/restored", params: {} });
  expect(receive).not.toHaveBeenCalledWith("stale");
  receive.mockClear();
  backend.invoke.mockResolvedValueOnce(batch(99, [], true));
  await vi.advanceTimersByTimeAsync(250);
  expect(receive.mock.calls.map(([event]) => event.method)).toEqual(["connection/closed", "connection/restored"]);
});

it("cleans up a rejected initial subscription and allows retry", async () => {
  const { subscribeGuiEvent } = await import("../../../../../shared/conversation/webEvents");
  backend.invoke.mockRejectedValueOnce(new Error("access denied"));
  await expect(subscribeGuiEvent("codex-gui-event", vi.fn())).rejects.toThrow("access denied");
  await vi.advanceTimersByTimeAsync(5000);
  expect(backend.invoke).toHaveBeenCalledTimes(1);
  stops.push(await subscribeGuiEvent("codex-gui-event", vi.fn()));
  expect(backend.invoke).toHaveBeenCalledTimes(2);
});

it("preserves native desktop subscriptions", async () => {
  backend.isDesktopApp = true;
  const { subscribeGuiEvent } = await import("../../../../../shared/conversation/webEvents");
  native.listen.mockResolvedValue(vi.fn());
  stops.push(await subscribeGuiEvent("codex-gui-event", vi.fn()));
  expect(native.listen).toHaveBeenCalledWith("codex-gui-event", expect.any(Function));
  expect(backend.invoke).not.toHaveBeenCalled();
});

it("keeps a replacement subscription when an earlier cleanup runs twice", async () => {
  const { subscribeGuiEvent } = await import("../../../../../shared/conversation/webEvents");
  const previous = await subscribeGuiEvent("codex-gui-event", vi.fn());
  previous();
  const receive = vi.fn();
  stops.push(await subscribeGuiEvent("codex-gui-event", receive));
  previous();
  backend.invoke.mockResolvedValueOnce(batch(1, [{ name: "codex-gui-event", payload: "new" }]));
  await vi.advanceTimersByTimeAsync(250);
  expect(receive).toHaveBeenCalledWith("new");
});

it("ignores a failed in-flight poll after the final subscriber leaves", async () => {
  const { subscribeGuiEvent } = await import("../../../../../shared/conversation/webEvents");
  const receive = vi.fn();
  const stop = await subscribeGuiEvent("codex-gui-event", receive);
  let reject!: (reason: Error) => void;
  backend.invoke.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
  await vi.advanceTimersByTimeAsync(250);
  stop();
  reject(new Error("closed"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(receive).not.toHaveBeenCalled();
  expect(backend.invoke).toHaveBeenCalledTimes(2);
});
