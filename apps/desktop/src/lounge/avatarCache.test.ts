// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { browserAvatarStore } from '../../../../shared/lounge/avatar';
import { LoungeAvatarCache, loungeAvatarVersion } from '../../../../shared/lounge/avatarCache';
import { LoungeProfiles } from '../../../../shared/lounge/profiles';

const avatar = 'data:image/png;base64,AAAA';
beforeEach(() => localStorage.clear());

it('retains bitmap and reset versions across controller restarts, isolated by server and user', () => {
  const first = new LoungeAvatarCache(browserAvatarStore('https://one.test/'));
  first.set('alice', avatar); first.set('bob', '');
  const reopened = new LoungeAvatarCache(browserAvatarStore('https://one.test'));
  expect(reopened.versions(['alice', 'bob', 'missing']))
    .toEqual({ alice: loungeAvatarVersion(avatar), bob: loungeAvatarVersion('') });
  expect(new LoungeAvatarCache(browserAvatarStore('https://two.test')).versions(['alice', 'bob'])).toEqual({});
  expect(loungeAvatarVersion('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

it('never advertises missing, corrupted or unavailable storage as a valid cache hit', () => {
  const store = browserAvatarStore('https://one.test');
  store.save('corrupt', 'https://tracker.test/avatar');
  const cache = new LoungeAvatarCache(store);
  expect(cache.versions(['corrupt', 'missing'])).toEqual({});
  const unavailable = new LoungeAvatarCache({ load() { throw new Error('storage'); }, save() { throw new Error('quota'); } });
  expect(unavailable.versions(['alice'])).toEqual({});
  unavailable.set('alice', avatar);
  expect(unavailable.versions(['alice'])).toEqual({ alice: loungeAvatarVersion(avatar) });
});

it('resolves offline history through the persisted profile, including cleared avatars', () => {
  const store = browserAvatarStore('https://one.test');
  store.save('alice', avatar); store.save('bob', '');
  const profiles = new LoungeProfiles(store);
  expect(profiles.user({ id: 'alice', account: 'alice' }).avatar).toBe(avatar);
  expect(profiles.user({ id: 'bob', account: 'bob', avatar }).avatar).toBeUndefined();
});
