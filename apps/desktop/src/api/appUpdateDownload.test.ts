import type { Update } from "@tauri-apps/plugin-updater";
import { beforeEach, expect, it, vi } from "vitest";
import { enablePeerDownload } from "./appUpdateDownload";

const native = vi.hoisted(() => ({ invoke: vi.fn(), close: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class { onmessage?: (event: unknown) => void; },
  Resource: class {
    constructor(readonly rid: number) {}
    close() { return native.close(this.rid); }
  },
}));

function fixture() {
  const close = vi.fn().mockResolvedValue(undefined);
  const original = { rid: 7, close, version: "2.0.0" } as unknown as Update;
  return { update: enablePeerDownload(original), close };
}

beforeEach(() => { vi.clearAllMocks(); native.invoke.mockResolvedValue(11); });

it("uses the GitHub resource for download and binds installation to that exact resource", async () => {
  const { update } = fixture();
  await expect(update.install()).rejects.toThrow("not finished downloading");
  const progress = vi.fn();
  await update.download(progress);
  expect(native.invoke).toHaveBeenCalledWith("download_shared_app_update", {
    rid: 7, onEvent: expect.objectContaining({ onmessage: progress }),
  });
  await update.install();
  expect(native.invoke).toHaveBeenLastCalledWith("install_shared_app_update", { updateRid: 7, bytesRid: 11 });
  await update.close();
  expect(native.close).not.toHaveBeenCalled();
});

it("retains verified bytes after installation fails and releases them when discarded", async () => {
  const { update, close } = fixture();
  await update.download();
  native.invoke.mockRejectedValueOnce(new Error("installer busy"));
  await expect(update.install()).rejects.toThrow("installer busy");
  await update.close();
  expect(native.close).toHaveBeenCalledWith(11);
  expect(close).toHaveBeenCalledOnce();
});

it("never makes a failed download installable", async () => {
  const { update } = fixture();
  native.invoke.mockRejectedValueOnce(new Error("download failed"));
  await expect(update.download()).rejects.toThrow("download failed");
  await expect(update.install()).rejects.toThrow("not finished downloading");
});
