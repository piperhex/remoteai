import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";

const updater = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: updater.check }));
vi.mock("./appUpdateDownload", () => ({ enablePeerDownload: (update: unknown) => update }));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn(), relaunch: updater.relaunch }));

const PENDING_VERSION_KEY = "codex-switch:pending-app-update-version";
const AUTO_UPDATE_KEY = "codex-switch:auto-update-enabled";
const UPDATE_VERSION = "1.4.5";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function createUpdate() {
  return {
    version: UPDATE_VERSION,
    currentVersion: "1.4.4",
    body: "Update notes",
    download: vi.fn(async (_onEvent?: (event: DownloadEvent) => void) => undefined),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

async function loadApp() {
  const preferences = await import("./appUpdatePreferences");
  const backend = await import("./backend");
  return { preferences, backend };
}

describe("automatic app updates", () => {
  let stored: Map<string, string>;
  let update: ReturnType<typeof createUpdate>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    updater.check.mockReset();
    updater.relaunch.mockReset().mockResolvedValue(undefined);
    stored = new Map();
    update = createUpdate();
    updater.check.mockResolvedValue(update);
    const localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    };
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      __TAURI_INTERNALS__: {}, localStorage, setTimeout, clearTimeout,
    }));
    vi.stubGlobal("document", { querySelector: () => null });
  });

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("resets progress when a partial peer download falls back to GitHub", async () => {
    update.download.mockImplementation(async (report) => {
      report?.({ event: "Started", data: { contentLength: 100 } });
      report?.({ event: "Progress", data: { chunkLength: 60 } });
      report?.({ event: "Started", data: { contentLength: 100 } });
      report?.({ event: "Progress", data: { chunkLength: 20 } });
      report?.({ event: "Finished" });
    });
    const { backend } = await loadApp();
    const progress = vi.fn();
    await backend.downloadAvailableUpdate(progress);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([0, 60, 0, 20, 100]);
  });

  it("refuses a remote install when the downloaded version differs from the confirmation", async () => {
    const { backend } = await loadApp();
    await backend.downloadAvailableUpdate();
    await expect(backend.installDownloadedUpdate("other-version")).rejects.toThrow("available update has changed");
    expect(update.install).not.toHaveBeenCalled();
    expect(updater.relaunch).not.toHaveBeenCalled();
    await backend.installDownloadedUpdate(UPDATE_VERSION);
    expect(update.install).toHaveBeenCalledOnce();
  });

  it("does not start a second installer when local and remote requests overlap", async () => {
    const { backend } = await loadApp();
    await backend.downloadAvailableUpdate();
    const installing = deferred<undefined>();
    update.install.mockImplementation(() => installing.promise);
    const first = backend.installDownloadedUpdate(UPDATE_VERSION);
    await backend.installDownloadedUpdate(UPDATE_VERSION);
    expect(update.install).toHaveBeenCalledOnce();
    installing.resolve(undefined); await first;
    expect(updater.relaunch).toHaveBeenCalledOnce();
  });

  it("defaults to enabled and installs a pending update on launch", async () => {
    stored.set(PENDING_VERSION_KEY, UPDATE_VERSION);
    const { backend, preferences } = await loadApp();

    expect(preferences.isAutoUpdateEnabled()).toBe(true);
    await backend.installPendingAppUpdateOnLaunch();

    expect(updater.check).toHaveBeenCalledOnce();
    expect(update.download).toHaveBeenCalledOnce();
    expect(update.install).toHaveBeenCalledOnce();
    expect(updater.relaunch).toHaveBeenCalledOnce();
    expect(stored.has(PENDING_VERSION_KEY)).toBe(false);
  });

  it("persists disabling and retains a pending update without installing it after restart", async () => {
    stored.set(PENDING_VERSION_KEY, UPDATE_VERSION);
    const { preferences } = await loadApp();
    preferences.setAutoUpdateEnabled(false);

    expect(stored.get(AUTO_UPDATE_KEY)).toBe("false");
    expect(stored.get(PENDING_VERSION_KEY)).toBe(UPDATE_VERSION);
    vi.resetModules();
    const restarted = await loadApp();
    expect(restarted.preferences.isAutoUpdateEnabled()).toBe(false);
    expect(restarted.backend.hasPendingAppUpdateInstall()).toBe(false);
    await restarted.backend.installPendingAppUpdateOnLaunch();

    expect(updater.check).not.toHaveBeenCalled();
    expect(update.download).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(updater.relaunch).not.toHaveBeenCalled();
    expect(stored.get(PENDING_VERSION_KEY)).toBe(UPDATE_VERSION);
  });

  it("keeps checking and downloading in the background while automatic installation is disabled", async () => {
    stored.set(AUTO_UPDATE_KEY, "false");
    const { backend } = await loadApp();

    await backend.checkForUpdate();
    await backend.downloadAvailableUpdate();
    await backend.installPendingAppUpdateOnLaunch();

    expect(updater.check).toHaveBeenCalledOnce();
    expect(update.download).toHaveBeenCalledOnce();
    expect(update.install).not.toHaveBeenCalled();
    expect(updater.relaunch).not.toHaveBeenCalled();
    expect(stored.get(PENDING_VERSION_KEY)).toBe(UPDATE_VERSION);
    expect(backend.hasPendingAppUpdateInstall()).toBe(false);
  });

  it("stops a launch update when disabled while checking for updates", async () => {
    stored.set(PENDING_VERSION_KEY, UPDATE_VERSION);
    const checking = deferred<ReturnType<typeof createUpdate>>();
    updater.check.mockReturnValue(checking.promise);
    const { backend, preferences } = await loadApp();
    const launching = backend.installPendingAppUpdateOnLaunch();
    expect(updater.check).toHaveBeenCalledOnce();

    preferences.setAutoUpdateEnabled(false);
    checking.resolve(update);
    await launching;

    expect(update.download).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(updater.relaunch).not.toHaveBeenCalled();
    expect(stored.get(PENDING_VERSION_KEY)).toBe(UPDATE_VERSION);
  });

  it("keeps the download without installing when disabled during a launch download", async () => {
    stored.set(PENDING_VERSION_KEY, UPDATE_VERSION);
    const downloading = deferred<undefined>();
    const downloadStarted = deferred<undefined>();
    update.download.mockImplementation(() => {
      downloadStarted.resolve(undefined);
      return downloading.promise;
    });
    const { backend, preferences } = await loadApp();
    const launching = backend.installPendingAppUpdateOnLaunch();
    await downloadStarted.promise;

    preferences.setAutoUpdateEnabled(false);
    downloading.resolve(undefined);
    await launching;

    expect(update.install).not.toHaveBeenCalled();
    expect(updater.relaunch).not.toHaveBeenCalled();
    expect(stored.get(PENDING_VERSION_KEY)).toBe(UPDATE_VERSION);
    expect(backend.hasPendingAppUpdateInstall()).toBe(false);
  });

  it("installs an update downloaded while disabled after re-enabling and restarting", async () => {
    stored.set(AUTO_UPDATE_KEY, "false");
    const { backend, preferences } = await loadApp();
    await backend.checkForUpdate();
    await backend.downloadAvailableUpdate();

    preferences.setAutoUpdateEnabled(true);
    expect(stored.get(AUTO_UPDATE_KEY)).toBe("true");
    vi.resetModules();
    const restarted = await loadApp();
    expect(restarted.backend.hasPendingAppUpdateInstall()).toBe(true);
    await restarted.backend.installPendingAppUpdateOnLaunch();

    expect(update.install).toHaveBeenCalledOnce();
    expect(updater.relaunch).toHaveBeenCalledOnce();
    expect(stored.has(PENDING_VERSION_KEY)).toBe(false);
  });

  it("still allows an explicit download and installation while automatic updates are disabled", async () => {
    stored.set(AUTO_UPDATE_KEY, "false");
    const { backend } = await loadApp();

    await backend.checkForUpdate();
    await backend.downloadAvailableUpdate();
    expect(stored.get(PENDING_VERSION_KEY)).toBe(UPDATE_VERSION);
    await backend.installDownloadedUpdate();

    expect(update.download).toHaveBeenCalledOnce();
    expect(update.install).toHaveBeenCalledOnce();
    expect(updater.relaunch).toHaveBeenCalledOnce();
    expect(stored.get(AUTO_UPDATE_KEY)).toBe("false");
    expect(stored.has(PENDING_VERSION_KEY)).toBe(false);
  });

  it("retains a failed explicit installation without installing on restart while disabled", async () => {
    stored.set(AUTO_UPDATE_KEY, "false");
    update.install.mockRejectedValue(new Error("Installer failed"));
    const { backend } = await loadApp();
    await backend.downloadAvailableUpdate();

    await expect(backend.installDownloadedUpdate()).rejects.toThrow("Installer failed");
    vi.resetModules();
    const restarted = await loadApp();
    await restarted.backend.installPendingAppUpdateOnLaunch();

    expect(update.install).toHaveBeenCalledOnce();
    expect(updater.relaunch).not.toHaveBeenCalled();
    expect(stored.get(PENDING_VERSION_KEY)).toBe(UPDATE_VERSION);
    expect(restarted.backend.hasPendingAppUpdateInstall()).toBe(false);
  });

  it("replaces a downloaded release when a fresh check finds a newer version", async () => {
    const { backend } = await loadApp();
    await backend.downloadAvailableUpdate();
    const newer = { ...createUpdate(), version: "1.4.6" };
    updater.check.mockResolvedValueOnce(newer);

    const latest = await backend.checkForUpdate({ force: true, replacePending: true });
    expect(updater.check).toHaveBeenCalledTimes(2);
    expect(latest?.latestVersion).toBe(newer.version);
    expect(update.close).toHaveBeenCalledOnce();
    await expect(backend.installDownloadedUpdate()).rejects.toThrow("not finished downloading");
    await backend.downloadAvailableUpdate();

    expect(newer.download).toHaveBeenCalledOnce();
    expect(update.install).not.toHaveBeenCalled();
    expect(newer.install).not.toHaveBeenCalled();
    expect(stored.get(PENDING_VERSION_KEY)).toBe(newer.version);
  });

  it.each([UPDATE_VERSION, "1.4.4", null])("retains the downloaded release if the check returns %s", async (version) => {
    const { backend } = await loadApp();
    await backend.downloadAvailableUpdate();
    const candidate = version ? { ...createUpdate(), version } : null;
    updater.check.mockResolvedValueOnce(candidate);

    const latest = await backend.checkForUpdate({ force: true, replacePending: true });
    expect(latest?.latestVersion).toBe(UPDATE_VERSION);
    expect(update.close).not.toHaveBeenCalled();
    if (candidate) expect(candidate.close).toHaveBeenCalledOnce();
    await backend.installDownloadedUpdate();
    expect(update.install).toHaveBeenCalledOnce();
    expect(update.download).toHaveBeenCalledOnce();
  });

  it("releases a stalled shared check so the next check can succeed", async () => {
    const { backend } = await loadApp();
    updater.check.mockReturnValueOnce(new Promise(() => undefined));
    const checking = backend.checkForUpdate();
    expect(backend.checkForUpdate()).toBe(checking);
    const result = expect(checking).rejects.toThrow("Update check timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await result;

    await expect(backend.checkForUpdate()).resolves.toMatchObject({ latestVersion: UPDATE_VERSION });
    expect(updater.check).toHaveBeenCalledTimes(2);
  });

  it("preserves the download on timeout and discards a late newer version after a successful retry", async () => {
    const { backend } = await loadApp();
    await backend.downloadAvailableUpdate();
    const checking = deferred<ReturnType<typeof createUpdate>>();
    updater.check.mockReturnValueOnce(checking.promise);
    const failed = backend.checkForUpdate({ force: true, replacePending: true });
    const result = expect(failed).rejects.toThrow("Update check timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(update.close).not.toHaveBeenCalled();
    expect(stored.get(PENDING_VERSION_KEY)).toBe(UPDATE_VERSION);

    const candidate = createUpdate();
    updater.check.mockResolvedValueOnce(candidate);
    await backend.checkForUpdate({ force: true, replacePending: true });
    const lateUpdate = { ...createUpdate(), version: "1.4.6" };
    checking.resolve(lateUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(lateUpdate.close).toHaveBeenCalledOnce();
    expect(update.close).not.toHaveBeenCalled();
    await backend.installDownloadedUpdate();
    expect(update.install).toHaveBeenCalledOnce();
    expect(update.download).toHaveBeenCalledOnce();
    expect(lateUpdate.download).not.toHaveBeenCalled();
  });
});
