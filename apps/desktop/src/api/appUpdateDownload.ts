import { Channel, invoke, Resource } from "@tauri-apps/api/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

/** Keep GitHub checking unchanged; only replace package download and installation. */
export function enablePeerDownload(update: Update): Update {
  let bytes: Resource | undefined;
  const close = update.close.bind(update);
  update.download = async (onEvent) => {
    const channel = new Channel<DownloadEvent>();
    if (onEvent) channel.onmessage = onEvent;
    const resourceId = await invoke<number>("download_shared_app_update", { rid: update.rid, onEvent: channel });
    await bytes?.close();
    bytes = new Resource(resourceId);
  };
  update.install = async () => {
    if (!bytes) throw new Error("The update has not finished downloading");
    await invoke("install_shared_app_update", { updateRid: update.rid, bytesRid: bytes.rid });
    bytes = undefined;
  };
  update.close = async () => {
    await bytes?.close();
    bytes = undefined;
    await close();
  };
  return update;
}
