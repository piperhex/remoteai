import { invoke, isTauri } from '@tauri-apps/api/core';
import { browserVaultKeyStorage } from '../../../../shared/browser/data/browserVaultKeyStorage';
import { isRememberedVaultKey, serializeVaultKeyStorage,
  type VaultKeyStorage } from '../../../../shared/browser/data/vaultKeyStorage';

const stores = new Map<string, VaultKeyStorage>();
export function desktopBrowserVaultKeyStorage(scope: string) {
  if (!isTauri()) return browserVaultKeyStorage(scope);
  const existing = stores.get(scope);
  if (existing) return existing;
  const storage = serializeVaultKeyStorage({
    read: async () => {
      const value = await invoke<unknown>('browser_vault_key', { scope, request: { action: 'read' } });
      if (value === null) return;
      if (!isRememberedVaultKey(value)) throw new Error('vault-key-storage');
      return value;
    },
    write: async value => { await invoke('browser_vault_key', { scope, request: { action: 'write', value } }); },
    remove: async () => { await invoke('browser_vault_key', { scope, request: { action: 'remove' } }); },
  });
  stores.set(scope, storage);
  return storage;
}
