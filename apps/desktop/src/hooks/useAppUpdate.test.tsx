// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkForUpdate, downloadAvailableUpdate, installDownloadedUpdate } from "../api/backend";
import { AppUpdateCheckTimeoutError } from "../api/appUpdateErrors";
import type { AppUpdateDownloadProgress } from "../api/appUpdateProgress";
import type { Translate } from "../i18n";
import type { UpdateInfo } from "../types";
import { useAppUpdate } from "./useAppUpdate";

vi.mock("../api/backend", () => ({
  checkForUpdate: vi.fn(),
  downloadAvailableUpdate: vi.fn(),
  installDownloadedUpdate: vi.fn(),
  hasPendingAppUpdateInstall: () => false,
}));
vi.mock('../../../../shared/platform/localBackend', async () => await import('../api/backend'));

const update: UpdateInfo = {
  currentVersion: "1.4.4", latestVersion: "1.4.5", releaseName: "Update",
  releaseNotes: null, releaseUrl: "https://example.com/releases",
};
const newerUpdate = { ...update, latestVersion: "1.4.6" };
const notify = vi.fn();
const translate: Translate = (key) => key;
let root: Root;
let controls: ReturnType<typeof useAppUpdate>;

function Fixture() {
  controls = useAppUpdate(notify, translate);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.mocked(checkForUpdate).mockResolvedValue(update);
  vi.mocked(downloadAvailableUpdate).mockResolvedValue(undefined);
  vi.mocked(installDownloadedUpdate).mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Fixture />));
  expect(controls.updateDownloaded).toBe(true);
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("downloads a newer release and waits for another click before installing", async () => {
  const downloading = deferred<void>();
  vi.mocked(checkForUpdate).mockResolvedValue(newerUpdate);
  vi.mocked(downloadAvailableUpdate).mockReturnValueOnce(downloading.promise);
  let installing!: Promise<void>;
  await act(async () => { installing = controls.installUpdate(); });

  expect(checkForUpdate).toHaveBeenCalledWith({ force: true, replacePending: true });
  expect(controls.availableUpdate?.latestVersion).toBe(newerUpdate.latestVersion);
  expect(controls.updateDownloaded).toBe(false);
  expect(controls.downloadingUpdate).toBe(true);
  expect(controls.installingUpdate).toBe(false);
  expect(installDownloadedUpdate).not.toHaveBeenCalled();

  await act(async () => { downloading.resolve(); await installing; });
  expect(controls.updateDownloaded).toBe(true);
  expect(controls.showUpdatePrompt).toBe(true);
  expect(installDownloadedUpdate).not.toHaveBeenCalled();

  await act(async () => controls.installUpdate());
  expect(checkForUpdate).toHaveBeenCalledTimes(2);
  expect(installDownloadedUpdate).toHaveBeenCalledOnce();
});

it("installs the downloaded release when the fresh check returns the same version", async () => {
  await act(async () => controls.installUpdate());
  expect(checkForUpdate).toHaveBeenCalledWith({ force: true, replacePending: true });
  expect(downloadAvailableUpdate).not.toHaveBeenCalled();
  expect(installDownloadedUpdate).toHaveBeenCalledOnce();
});

it("keeps live download details when the prompt is closed and reopened", async () => {
  const downloading = deferred<void>();
  const details: AppUpdateDownloadProgress = {
    percent: 41, downloadedBytes: 41_000, totalBytes: 100_000, bytesPerSecond: 2_048,
    phase: "downloading", elapsedSeconds: 20,
  };
  vi.mocked(downloadAvailableUpdate).mockImplementationOnce((report) => {
    report?.(details.percent, details);
    return downloading.promise;
  });
  let request!: Promise<boolean>;
  await act(async () => { request = controls.downloadUpdate(newerUpdate, true); });
  expect(controls.updateProgress).toBe(41);
  expect(controls.updateDownloadProgress).toEqual(details);
  await act(async () => controls.setShowUpdatePrompt(false));
  await act(async () => controls.showAvailableUpdate());
  expect(controls.updateDownloadProgress).toEqual(details);
  await act(async () => { downloading.resolve(); await request; });
  expect(controls.updateDownloaded).toBe(true);
});

it("blocks duplicate clicks and background refreshes during the pre-install check", async () => {
  const checking = deferred<UpdateInfo | null>();
  vi.mocked(checkForUpdate).mockReturnValueOnce(checking.promise);
  let installing!: Promise<void>;
  await act(async () => {
    installing = controls.installUpdate();
    await controls.installUpdate();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  });
  expect(controls.checkingBeforeInstall).toBe(true);
  expect(controls.installingUpdate).toBe(false);
  expect(checkForUpdate).toHaveBeenCalledOnce();
  expect(installDownloadedUpdate).not.toHaveBeenCalled();

  await act(async () => { checking.resolve(update); await installing; });
  expect(controls.checkingBeforeInstall).toBe(false);
  expect(installDownloadedUpdate).toHaveBeenCalledOnce();
});

it("preserves the downloaded release after a failed check and allows retry", async () => {
  vi.mocked(checkForUpdate).mockRejectedValueOnce(new Error("Check failed"));
  await act(async () => controls.installUpdate());
  expect(controls.updateDownloaded).toBe(true);
  expect(controls.updateInstallError).toContain("Check failed");
  expect(controls.checkingBeforeInstall).toBe(false);
  expect(controls.installingUpdate).toBe(false);
  expect(installDownloadedUpdate).not.toHaveBeenCalled();

  await act(async () => controls.installUpdate());
  expect(controls.updateInstallError).toBeNull();
  expect(installDownloadedUpdate).toHaveBeenCalledOnce();
});

it("restores the prompt after a check timeout and retries without downloading again", async () => {
  vi.mocked(checkForUpdate).mockRejectedValueOnce(new AppUpdateCheckTimeoutError());
  await act(async () => controls.installUpdate());
  expect(controls.updateInstallError).toBe("update.checkTimeout");
  expect(controls.checkingBeforeInstall).toBe(false);
  expect(controls.installingUpdate).toBe(false);
  expect(controls.updateDownloaded).toBe(true);
  expect(installDownloadedUpdate).not.toHaveBeenCalled();

  await act(async () => controls.installUpdate());
  expect(controls.updateInstallError).toBeNull();
  expect(downloadAvailableUpdate).not.toHaveBeenCalled();
  expect(installDownloadedUpdate).toHaveBeenCalledOnce();
});

it("keeps installation unavailable when downloading the newer release fails", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue(newerUpdate);
  vi.mocked(downloadAvailableUpdate).mockRejectedValueOnce(new Error("Download failed"));
  await act(async () => controls.installUpdate());
  expect(controls.availableUpdate?.latestVersion).toBe(newerUpdate.latestVersion);
  expect(controls.updateDownloaded).toBe(false);
  expect(controls.downloadingUpdate).toBe(false);
  expect(controls.downloadRequested).toBe(false);
  expect(controls.updateInstallError).toContain("Download failed");
  expect(installDownloadedUpdate).not.toHaveBeenCalled();
});

it("lets a manual update take over an in-flight background check without duplicate downloads", async () => {
  const checking = deferred<UpdateInfo | null>();
  vi.mocked(checkForUpdate).mockReturnValue(checking.promise);
  await act(async () => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
  await act(async () => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
  expect(checkForUpdate).toHaveBeenCalledOnce();
  let installing!: Promise<void>;
  await act(async () => { installing = controls.installUpdate(); });
  await act(async () => { checking.resolve(newerUpdate); await installing; });
  expect(downloadAvailableUpdate).toHaveBeenCalledOnce();
  expect(installDownloadedUpdate).not.toHaveBeenCalled();
  expect(controls.updateDownloaded).toBe(true);
  expect(controls.availableUpdate?.latestVersion).toBe(newerUpdate.latestVersion);
});
