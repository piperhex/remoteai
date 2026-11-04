import type { LocalProxyLanApiKey, LocalProxyLanApiKeyInput } from "../types";
import { listen } from "@tauri-apps/api/event";
import { copyText } from "../../../../shared/clipboard";
import { hasLocalBackend, isDesktopApp, isHostedWebApp, invoke } from "./backend";
import { previewCopyLocalProxyLanApiKey, previewDeleteLocalProxyLanApiKey,
  previewLocalProxyLanApiKeys, previewSaveLocalProxyLanApiKey } from "./localProxyLanKeysPreview";

export function subscribeToLocalProxyLanKeyChanges(onChange: () => void): () => void {
  if (!isDesktopApp) return () => undefined;
  // Polling remains available if native events cannot be registered.
  const subscription = listen("local-proxy-lan-keys-updated", onChange).catch(() => () => undefined);
  return () => { void subscription.then((unlisten) => unlisten()); };
}

export async function loadLocalProxyLanApiKeys(): Promise<LocalProxyLanApiKey[]> {
  if (!hasLocalBackend) return previewLocalProxyLanApiKeys();
  return invoke<LocalProxyLanApiKey[]>("list_local_proxy_lan_api_keys");
}

export async function saveLocalProxyLanApiKey(key: LocalProxyLanApiKeyInput): Promise<LocalProxyLanApiKey[]> {
  if (!hasLocalBackend) return previewSaveLocalProxyLanApiKey(key);
  return invoke<LocalProxyLanApiKey[]>("save_local_proxy_lan_api_key", { key });
}

export async function deleteLocalProxyLanApiKey(id: string): Promise<LocalProxyLanApiKey[]> {
  if (!hasLocalBackend) return previewDeleteLocalProxyLanApiKey(id);
  return invoke<LocalProxyLanApiKey[]>("delete_local_proxy_lan_api_key", { id });
}

export async function copyLocalProxyLanApiKey(id: string): Promise<void> {
  if (!hasLocalBackend) return previewCopyLocalProxyLanApiKey(id);
  if (isHostedWebApp) {
    const secret = await invoke<string>("copy_local_proxy_lan_api_key", { id });
    return copyText(secret);
  }
  return invoke<void>("copy_local_proxy_lan_api_key", { id });
}
