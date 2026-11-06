import { afterEach, expect, it, vi } from 'vitest';
import { LoungeDirectDelivery } from '../../../../shared/lounge/directDelivery';
import { LoungeGroupReadViewport } from '../../../../shared/lounge/groupReadViewport';
import { mergeDelivery, needsDeliveryWork } from '../../../../shared/lounge/delivery';
import { historyKey } from '../../../../shared/lounge/archive';
import type { LoungeAccount, LoungeMessage } from '../../../../shared/lounge/types';

const admin = { id: 'admin', account: 'admin', moderator: true };
const bob = { id: 'bob', account: 'bob', nickname: '小波' };
const carol = { id: 'carol', account: 'carol' };
const settle = async () => { for (let step = 0; step < 50; step++) await Promise.resolve(); };
const engines: LoungeDirectDelivery[] = [];
function message(sender = admin): LoungeMessage {
  return { type: 'message', id: 'announcement', sender, text: 'hello', images: [],
    groupReceipt: 'signed-group-capability', sentAt: new Date().toISOString() };
}
function fixture(self: LoungeAccount = admin) {
  const state = { moderator: self.moderator, readable: false, group: true };
  const rows = new Map<string, LoungeMessage>();
  const frames: Record<string, unknown>[] = [];
  const engine = new LoungeDirectDelivery({
    self: () => ({ ...self, moderator: state.moderator }), enabled: () => true,
    groupEnabled: () => state.group, online: () => false, readable: () => state.readable, allowed: () => true,
    find: async key => rows.get(key), page: async () => ({ messages: [...rows.values()]
      .filter(row => needsDeliveryWork(row.delivery)) }),
    publish: async row => { rows.set(historyKey(row), { ...row,
      delivery: mergeDelivery(rows.get(historyKey(row))?.delivery, row.delivery) }); },
    transmit: frame => { frames.push(frame); return true; }, error: () => { throw new Error('Archive failed'); },
  });
  engines.push(engine); engine.start();
  return { state, rows, frames, engine };
}
afterEach(() => { engines.splice(0).forEach(engine => engine.stop()); vi.useRealTimers(); });

it('counts unique authenticated readers, retains their names and acknowledges duplicate devices', async () => {
  const { engine, rows, frames, state } = fixture();
  const sent = message(); engine.receive(sent); await settle();
  expect(rows.get(historyKey(sent))?.delivery?.readers).toEqual([]);
  for (const reader of [bob, bob, carol]) engine.receipt({ type: 'group-read', id: sent.id,
    from: reader.id, to: admin.id, reader, groupReceipt: sent.groupReceipt });
  await settle();
  expect(rows.get(historyKey(sent))?.delivery?.readers).toEqual([bob, carol]);
  expect(frames.filter(frame => frame.type === 'group-read-confirm')).toHaveLength(3);
  state.moderator = false;
  engine.receipt({ type: 'group-read', id: sent.id, from: 'eve', to: admin.id,
    reader: { id: 'eve', account: 'eve' }, groupReceipt: sent.groupReceipt });
  await settle(); expect(rows.get(historyKey(sent))?.delivery?.readers).toHaveLength(2);
});

it('never treats delivery, an invisible message or the sender itself as a group read', async () => {
  const { engine, rows, frames, state } = fixture(bob);
  const incoming = message(); engine.receive(incoming); await settle();
  expect(frames).toEqual([]);
  expect(rows.get(historyKey(incoming))?.delivery?.status).toBe('delivered');
  engine.read([...rows.values()]); await settle(); expect(frames).toEqual([]);
  state.readable = true;
  engine.read([...rows.values()]); await settle();
  expect(frames).toEqual([{ type: 'group-read', id: incoming.id, to: admin.id,
    groupReceipt: incoming.groupReceipt }]);
  engine.receipt({ type: 'group-read-confirm', id: incoming.id, from: admin.id, to: bob.id,
    groupReceipt: incoming.groupReceipt }); await settle();
  expect(needsDeliveryWork(rows.get(historyKey(incoming))?.delivery)).toBe(false);
});

it('retries an actual group read without a private contact and stops after durable confirmation', async () => {
  vi.useFakeTimers();
  const { engine, rows, frames, state } = fixture(bob);
  const incoming = message(); engine.receive(incoming); await settle();
  state.readable = true; engine.read([...rows.values()]); await settle();
  await vi.advanceTimersByTimeAsync(6000); await settle();
  expect(frames.filter(frame => frame.type === 'group-read')).toHaveLength(2);
  engine.receipt({ type: 'group-read-confirm', id: incoming.id, from: admin.id, to: bob.id,
    groupReceipt: incoming.groupReceipt }); await settle();
  await vi.advanceTimersByTimeAsync(6000);
  expect(frames.filter(frame => frame.type === 'group-read')).toHaveLength(2);
});

it('requires a visible active surface and pauses while another dialog or background window covers it', () => {
  let foreground = false;
  const read = vi.fn();
  const viewport = new LoungeGroupReadViewport({ enabled: () => foreground, read });
  const incoming = message();
  viewport.setViewing({ thread: true, history: false });
  viewport.observe({ message: incoming, visible: true }); expect(viewport.readable(incoming)).toBe(false);
  foreground = true; viewport.refresh(); expect(read).toHaveBeenLastCalledWith([incoming]);
  viewport.overlay('readers', true); expect(viewport.readable(incoming)).toBe(false);
  viewport.overlay('readers', false); expect(viewport.readable(incoming)).toBe(true);
  viewport.observe({ message: incoming, visible: false }); expect(viewport.readable(incoming)).toBe(false);
  viewport.observe({ message: incoming, visible: true, history: true });
  expect(viewport.readable(incoming)).toBe(false);
  viewport.setViewing({ thread: false, history: true }); expect(viewport.readable(incoming)).toBe(true);
});
