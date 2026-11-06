import { expect, it, vi } from 'vitest';
import { LoungeDeviceSync } from '../../../../shared/lounge/deviceSync';
import { HistorySyncConnection } from '../../../../shared/lounge/syncConnection';
import { INVALID_GROUP_RECEIPT } from '../../../../shared/lounge/groupReceipts';
import type { LoungeMessage } from '../../../../shared/lounge/types';

it('announces a terminal receipt failure to connected devices even when read status is unchanged', () => {
  const start = vi.spyOn(HistorySyncConnection.prototype, 'start').mockImplementation(() => {});
  const changed = vi.spyOn(HistorySyncConnection.prototype, 'changed').mockImplementation(() => {});
  const sync = new LoungeDeviceSync({ deviceId: () => 'device', flush: async () => {},
    restored: () => {}, error: () => {}, accept: () => true,
    session: { baseUrl: 'https://lounge.test', authorize: async () => ({ ticket: 'current' }),
      history: { get: async () => undefined, save: async () => {}, page: async () => ({ messages: [] }) },
      sync: { randomBytes: size => new Uint8Array(size), createPeer: () => { throw new Error('unused'); } } } });
  try {
    sync.ready('reader', true);
    const message: LoungeMessage = { type: 'message', id: 'historical', text: 'hello', images: [],
      sender: { id: 'admin', account: 'admin' }, sentAt: new Date().toISOString(), groupReceipt: 'old',
      delivery: { direction: 'incoming', status: 'read', confirmed: 'delivered' } };
    sync.changed(message); sync.changed(message);
    expect(changed).toHaveBeenCalledTimes(1);
    const failed: LoungeMessage = { ...message,
      delivery: { ...message.delivery!, groupReceiptError: INVALID_GROUP_RECEIPT } };
    sync.changed(failed); sync.changed(failed);
    expect(changed).toHaveBeenCalledTimes(2);
  } finally { sync.stop(); start.mockRestore(); changed.mockRestore(); }
});
