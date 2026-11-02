import { beforeEach, expect, it, vi } from 'vitest';
import { nativeLoungeAvatars } from './avatarStore';
import { LoungeAvatarCache, loungeAvatarVersion } from '../../../../shared/lounge/avatarCache';

const persisted = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-sqlite/kv-store', () => ({ default: {
  getItemSync: (key: string) => persisted.get(key) ?? null,
  setItemSync: (key: string, value: string) => persisted.set(key, value),
} }));
beforeEach(() => persisted.clear());

it('reopens native avatar caches and reset markers using the same versions as web and desktop', () => {
  const avatar = 'data:image/png;base64,AAAA';
  const first = new LoungeAvatarCache(nativeLoungeAvatars('https://one.test/'));
  first.set('alice', avatar); first.set('bob', '');
  const reopened = new LoungeAvatarCache(nativeLoungeAvatars('https://one.test'));
  expect(reopened.versions(['alice', 'bob', 'unknown']))
    .toEqual({ alice: loungeAvatarVersion(avatar), bob: loungeAvatarVersion('') });
  expect(new LoungeAvatarCache(nativeLoungeAvatars('https://two.test')).versions(['alice'])).toEqual({});
  nativeLoungeAvatars('https://one.test').save('corrupt', 'not-an-image');
  expect(reopened.versions(['corrupt'])).toEqual({});
});
