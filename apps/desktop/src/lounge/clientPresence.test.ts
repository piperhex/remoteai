import { expect, it } from 'vitest';
import { hasOnlineClientDevices } from '../../../../shared/lounge/clientPresence';
import type { LoungeContact } from '../../../../shared/lounge/contacts';

const contact: LoungeContact = { direct: true, online: true,
  user: { id: 'bob', account: 'bob', clients: [{ version: '2.2.7', platform: 'desktop' }] } };

it('uses confirmed device presence and falls back for legacy clients', () => {
  expect(hasOnlineClientDevices(contact, 'connected')).toBe(true);
  expect(hasOnlineClientDevices({ ...contact, user: { ...contact.user,
    clients: [{ version: '1.5.3', platform: 'mobile' }] } }, 'connected')).toBe(true);
  for (const user of [{ id: 'bob', account: 'bob' }, { ...contact.user, clients: [] },
    { ...contact.user, clients: [{ version: '2.2.7' }] },
    { id: 'bob', account: 'bob', clientVersions: ['2.2.7'] }]) {
    expect(hasOnlineClientDevices({ ...contact, user }, 'connected')).toBe(false);
  }
});

it('never lights cached device versions while offline, hidden, pending or reconnecting', () => {
  for (const online of [false, null, undefined]) {
    expect(hasOnlineClientDevices({ ...contact, online }, 'connected')).toBe(false);
  }
  for (const status of ['connecting', 'signed-out'] as const) {
    expect(hasOnlineClientDevices(contact, status)).toBe(false);
  }
  expect(hasOnlineClientDevices(undefined, 'connected')).toBe(false);
});
