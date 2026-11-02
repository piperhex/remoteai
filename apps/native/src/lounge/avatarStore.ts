import Storage from 'expo-sqlite/kv-store';
import { avatarData, type LoungeAvatarStore } from '../../../../shared/lounge/avatar';

export function nativeLoungeAvatars(baseUrl: string): LoungeAvatarStore {
  const key = (id: string) => `lounge-avatar:${JSON.stringify([baseUrl.replace(/\/+$/, ''), id])}`;
  return {
    load(id) {
      try {
        const value = Storage.getItemSync(key(id));
        return value === '' || avatarData(value) ? value : undefined;
      } catch { return undefined; }
    },
    save(id, avatar) {
      try { Storage.setItemSync(key(id), avatar); }
      catch { throw new Error('client.lounge.avatarSaveFailed'); }
    },
  };
}
