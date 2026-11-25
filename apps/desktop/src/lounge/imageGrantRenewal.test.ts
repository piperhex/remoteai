import { expect, it, vi } from 'vitest';
import { ImageGrantRenewal } from '../../../../shared/lounge/imageGrantRenewal';
import type { LoungeMessage } from '../../../../shared/lounge/types';

it('renews only the image in the author archive for its original audience and request', async () => {
  const file = { id: 'photo', device: 'device', kind: 'image' as const, name: 'photo.png',
    mime: 'image/png', size: 8, grant: 'archived-token' };
  const message: LoungeMessage = { type: 'message', sender: { id: 'alice', account: 'alice' }, id: 'message',
    recipient: { id: 'bob', account: 'bob' }, text: '', images: [], attachments: [file], sentAt: new Date().toISOString() };
  const send = vi.fn<(_frame: Record<string, unknown>) => boolean>(() => true);
  const author = new ImageGrantRenewal({ self: () => 'alice', randomId: () => 'author', find: async () => message, send });
  const viewer = new ImageGrantRenewal({ self: () => 'bob', randomId: () => 'request', find: async () => undefined, send });
  const renewed = viewer.request(message, file);
  const request = send.mock.calls[0][0];
  author.receive({ ...request, from: 'someone-else' }); await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(1);
  author.receive({ ...request, from: 'bob' }); await Promise.resolve();
  expect(send.mock.calls[1][0]).toMatchObject({ type: 'image-grant-approve', to: 'bob', conversation: 'bob' });
  const reply = { ...request, type: 'image-grant', from: 'alice', grant: 'renewed' };
  viewer.receive({ ...reply, from: 'someone-else', grant: 'wrong' });
  viewer.receive(reply); await expect(renewed).resolves.toBe('renewed');
  delete message.recipient;
  author.receive({ ...request, from: 'viewer', proof: 'unrelated' }); await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(2);
  author.receive({ ...request, from: 'viewer' }); await Promise.resolve();
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ to: 'viewer', conversation: '' });
});
