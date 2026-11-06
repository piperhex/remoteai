// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { LoungeProfiles } from '../../../../shared/lounge/profiles';
import { browserClientPlatform, clientVersionItems, clientVersionLabel, parseClients,
  parseClientVersion, parseClientVersions } from '../../../../shared/lounge/clientVersion';
import { parseAccount } from '../../../../shared/lounge/contacts';

it('accepts release versions, deduplicates them and rejects malformed or unbounded metadata', () => {
  expect(parseClientVersion('2.2.7-beta.1+build.12')).toBe('2.2.7-beta.1+build.12');
  for (const value of ['', 'unknown', '<script>', 'v2.2.7', '1.2.3' + 'a'.repeat(64), null]) {
    expect(parseClientVersion(value)).toBeUndefined();
  }
  expect(parseClientVersions(['2.2.7', '2.2.4', '2.2.7'])).toEqual(['2.2.4', '2.2.7']);
  expect(parseClientVersions(Array(17).fill('2.2.7'))).toBeUndefined();
  expect(parseClientVersions(['2.2.7', 'invalid'])).toBeUndefined();
  expect(clientVersionLabel({ id: 'bob', account: 'bob' })).toBe('');
  expect(parseAccount({ id: 'bob', account: 'bob', clientVersions: ['2.2.7'] })?.clientVersions).toEqual(['2.2.7']);
});

it('keeps desktop and phone versions distinct, ordered and validated', () => {
  const clients = [{ version: '2.2.7', platform: 'mobile' }, { version: '2.2.7', platform: 'desktop' },
    { version: '2.2.7', platform: 'desktop' }];
  expect(parseClients(clients)).toEqual([{ version: '2.2.7', platform: 'desktop' },
    { version: '2.2.7', platform: 'mobile' }]);
  expect(parseClients([{ version: '2.2.7', platform: 'forged' }])).toBeUndefined();
  expect(clientVersionItems({ id: 'bob', account: 'bob', clients: [] })).toEqual([]);
  expect(browserClientPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
  expect(browserClientPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('mobile');
  expect(browserClientPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('mobile');
});

it('overrides stale message snapshots with live versions, including explicit removal and old clients', () => {
  const profiles = new LoungeProfiles();
  const user = { id: 'bob', account: 'bob', clientVersions: ['2.2.4'] };
  profiles.ready({ id: 'alice', account: 'alice' }, true);
  profiles.receiveVersions([{ id: 'bob', clientVersions: ['2.2.7', '2.2.4', '2.2.7'] }]);
  expect(clientVersionLabel(profiles.user(user))).toBe('v2.2.4 · v2.2.7');
  profiles.receiveVersions([{ id: 'bob', clientVersions: ['invalid'] }]);
  expect(clientVersionLabel(profiles.user(user))).toBe('v2.2.4 · v2.2.7');
  profiles.receiveVersions([{ id: 'bob', clientVersions: [] }]);
  expect(clientVersionLabel(profiles.user(user))).toBe('');
  profiles.clear();
  expect(profiles.user({ id: 'old', account: 'old' }).clientVersions).toBeUndefined();
});
