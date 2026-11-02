import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { avatarData, type LoungeAvatarStore } from './avatar';

/** Content versions survive reconnects without timestamps or platform-specific crypto APIs. */
export function loungeAvatarVersion(avatar: string) {
  return bytesToHex(sha256(utf8ToBytes(avatar)));
}

export class LoungeAvatarCache {
  private values = new Map<string, { avatar: string; version: string }>();
  constructor(private readonly store?: LoungeAvatarStore) {}

  clear() { this.values.clear(); }
  get(id: string) {
    if (this.values.has(id)) return this.values.get(id);
    try {
      const avatar = this.store?.load(id);
      if (avatar === '' || avatarData(avatar)) {
        const cached = { avatar, version: loungeAvatarVersion(avatar) };
        this.values.set(id, cached);
        return cached;
      }
    } catch { /* Unavailable local storage falls back to server synchronization. */ }
  }
  set(id: string, avatar: string) {
    this.values.set(id, { avatar, version: loungeAvatarVersion(avatar) });
    // Persist resets too: missing cache and a confirmed default avatar are different states.
    try { this.store?.save(id, avatar); } catch { /* Keep the accepted server value in memory. */ }
  }
  versions(ids: string[]) {
    return Object.fromEntries(ids.flatMap(id => {
      const cached = this.get(id);
      return cached ? [[id, cached.version]] : [];
    }));
  }
  retain(ids: string[]) {
    const retained = new Set(ids);
    for (const id of this.values.keys()) if (!retained.has(id)) this.values.delete(id);
  }
}
