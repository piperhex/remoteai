// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCliInstaller } from "./useCliInstaller";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), stop: vi.fn(), subscribe: vi.fn() }));
vi.mock("../../api/backend", () => ({ invoke: mocks.invoke }));
vi.mock("./webEvents", () => ({ subscribeGuiEvent: mocks.subscribe }));
const controller = { connect: vi.fn(), report: vi.fn(), clearError: vi.fn() };
let root: ReturnType<typeof createRoot>;
let installer: ReturnType<typeof useCliInstaller>;
const latest = { version: "0.100.0", size: 100, ready: false };
function Fixture({ active = true, autoUpdate = true }: { active?: boolean; autoUpdate?: boolean }) {
  installer = useCliInstaller(active, controller, autoUpdate);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const calls = (command: string) => mocks.invoke.mock.calls.filter(([name]) => name === command);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.subscribe.mockResolvedValue(mocks.stop);
  root = createRoot(document.createElement("div"));
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "codex_gui_cli_status") return { version: "0.99.0" };
    if (command === "codex_gui_cli_prepare") return { ...latest, ready: true };
    return latest;
  });
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("checks and silently prepares on every tab entry without reconnecting or installing", async () => {
  await act(async () => root.render(<StrictMode><Fixture /></StrictMode>));
  expect(calls("codex_gui_cli_check")).toHaveLength(1);
  expect(calls("codex_gui_cli_prepare")).toHaveLength(1);
  expect(installer.release?.ready).toBe(true);
  expect(installer.version).toBe("0.99.0");
  expect(installer.installing).toBe(false);
  await act(async () => root.render(<StrictMode><Fixture active={false} /></StrictMode>));
  await act(async () => root.render(<StrictMode><Fixture /></StrictMode>));
  expect(calls("codex_gui_cli_check")).toHaveLength(2);
  expect(calls("codex_gui_cli_install")).toHaveLength(0);
  expect(controller.connect).toHaveBeenCalledExactlyOnceWith({ reuseExisting: true });
});

it("connects immediately while an update check is slow and coalesces repeated entries", async () => {
  const check = deferred<typeof latest>();
  mocks.invoke.mockImplementation(async (command: string) => command === "codex_gui_cli_status"
    ? { version: "0.99.0" } : command === "codex_gui_cli_check" ? check.promise : latest);
  await act(async () => root.render(<Fixture />));
  expect(controller.connect).toHaveBeenCalledOnce();
  for (let i = 0; i < 3; i++) {
    await act(async () => root.render(<Fixture active={false} />));
    await act(async () => root.render(<Fixture />));
  }
  expect(calls("codex_gui_cli_check")).toHaveLength(1);
  await act(async () => check.resolve(latest));
  expect(calls("codex_gui_cli_check")).toHaveLength(2);
});

it("keeps background failures quiet and reports a failed manual check", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "codex_gui_cli_status") return { version: "0.99.0" };
    throw new Error("offline");
  });
  await act(async () => root.render(<Fixture />));
  expect(controller.report).not.toHaveBeenCalled();
  await act(async () => installer.check());
  expect(controller.report).toHaveBeenCalledWith(new Error("offline"));
});

it("restores a cached update indicator even when the online check fails", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "codex_gui_cli_status") return { version: "0.99.0", release: latest };
    throw new Error("offline");
  });
  await act(async () => root.render(<Fixture />));
  expect(installer.release).toEqual(latest);
  expect(controller.report).not.toHaveBeenCalled();
});

it("a delayed cached status cannot clear an update discovered by an online check", async () => {
  const status = deferred<{ version: string; release: null }>();
  mocks.invoke.mockImplementation(async (command: string) => command === "codex_gui_cli_status"
    ? status.promise : { ...latest, ready: true });
  await act(async () => root.render(<Fixture />));
  await act(async () => status.resolve({ version: "0.99.0", release: null }));
  expect(installer.version).toBe("0.99.0");
  expect(installer.release?.version).toBe(latest.version);
});

it("a late old download does not overwrite a newer release", async () => {
  const download = deferred<typeof latest>();
  let checkedVersion = latest;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "codex_gui_cli_status") return { version: "0.99.0" };
    if (command === "codex_gui_cli_prepare") return download.promise;
    return checkedVersion;
  });
  await act(async () => root.render(<Fixture />));
  checkedVersion = { ...latest, version: "0.101.0" };
  await act(async () => root.render(<Fixture active={false} />));
  await act(async () => root.render(<Fixture />));
  await act(async () => download.resolve({ ...latest, ready: true }));
  expect(installer.release?.version).toBe("0.101.0");
  expect(installer.release?.ready).toBe(false);
  expect(controller.report).not.toHaveBeenCalled();
});

it("silently retries a failed download on the next entry", async () => {
  const download = deferred<typeof latest>();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "codex_gui_cli_status") return { version: "0.99.0" };
    if (command === "codex_gui_cli_prepare") return download.promise;
    return latest;
  });
  await act(async () => root.render(<Fixture />));
  await act(async () => download.reject(new Error("download failed")));
  expect(controller.report).not.toHaveBeenCalled();
  await act(async () => root.render(<Fixture active={false} />));
  await act(async () => root.render(<Fixture />));
  expect(calls("codex_gui_cli_prepare")).toHaveLength(2);
  expect(controller.report).not.toHaveBeenCalled();
});

it("manual installation changes the active version and reconnects", async () => {
  const installing = deferred<{ version: string }>();
  await act(async () => root.render(<Fixture />));
  mocks.invoke.mockImplementation(async (command: string) => command === "codex_gui_cli_install"
    ? installing.promise : latest);
  let pending!: Promise<void>;
  await act(async () => { pending = installer.install(); void installer.install(); });
  expect(calls("codex_gui_cli_install")).toHaveLength(1);
  expect(installer.version).toBe("0.99.0");
  await act(async () => { installing.resolve({ version: "0.101.0" }); await pending; });
  expect(installer.version).toBe("0.101.0");
  expect(installer.release?.version).toBe("0.101.0");
  expect(controller.connect).toHaveBeenCalledTimes(2);
});

it("refreshes offline imports without requesting another download or interrupting active conversations", async () => {
  await act(async () => root.render(<Fixture />));
  const count = mocks.invoke.mock.calls.length;
  await act(async () => installer.onImported({ version: latest.version, release: null }));
  expect(installer.version).toBe(latest.version);
  expect(installer.release).toBeNull();
  expect(mocks.invoke.mock.calls).toHaveLength(count);
  expect(controller.connect).toHaveBeenLastCalledWith({ reuseExisting: true });
  expect(controller.clearError).toHaveBeenCalled();
});

it("receives background downloads and activation without installing or restarting again", async () => {
  await act(async () => root.render(<Fixture />));
  const receive = mocks.subscribe.mock.calls.find(([name]) => name === "codex-gui-cli-state")![1];
  await act(async () => receive({ version: "0.99.0", release: { ...latest, ready: true } }));
  expect(installer.release?.ready).toBe(true);
  await act(async () => receive({ version: latest.version, release: { ...latest, ready: true } }));
  expect(installer.version).toBe(latest.version);
  expect(calls("codex_gui_cli_install")).toHaveLength(0);
  expect(controller.connect).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Fixture active={false} />));
  await act(async () => receive({ version: "0.1.0", release: null }));
  expect(installer.version).toBe(latest.version);
});

it("refreshes the installed version after an update while the GUI was hidden", async () => {
  await act(async () => root.render(<Fixture />));
  await act(async () => root.render(<Fixture active={false} />));
  mocks.invoke.mockImplementation(async (command: string) => command === "codex_gui_cli_status"
    ? { version: latest.version } : { ...latest, ready: true });
  await act(async () => root.render(<Fixture />));
  expect(installer.version).toBe(latest.version);
  expect(controller.connect).toHaveBeenCalledTimes(1);
});

it("a delayed status response cannot undo a newer automatic activation", async () => {
  const status = deferred<{ version: string }>();
  mocks.invoke.mockImplementation(async (command: string) => command === "codex_gui_cli_status"
    ? status.promise : { ...latest, ready: true });
  await act(async () => root.render(<Fixture />));
  const receive = mocks.subscribe.mock.calls.find(([name]) => name === "codex-gui-cli-state")![1];
  await act(async () => receive({ version: latest.version, release: { ...latest, ready: true } }));
  await act(async () => status.resolve({ version: "0.99.0" }));
  expect(installer.version).toBe(latest.version);
  expect(controller.connect).toHaveBeenCalledExactlyOnceWith({ reuseExisting: true });
});

it("does not download again when ready, or update automatically in other shared installer views", async () => {
  mocks.invoke.mockImplementation(async (command: string) => command === "codex_gui_cli_status"
    ? { version: "0.99.0" } : { ...latest, ready: true });
  await act(async () => root.render(<Fixture />));
  expect(calls("codex_gui_cli_prepare")).toHaveLength(0);
  await act(async () => root.render(<Fixture active={false} autoUpdate={false} />));
  await act(async () => root.render(<Fixture autoUpdate={false} />));
  expect(calls("codex_gui_cli_check")).toHaveLength(1);
});
