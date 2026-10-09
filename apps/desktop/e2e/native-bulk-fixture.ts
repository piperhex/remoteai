import { mockIPC } from '@tauri-apps/api/mocks';
import type { Channel } from '@tauri-apps/api/core';
import { NativeGuiSocket } from '../src/pages/codexGui/remote/nativeSocket';
import { fixtureBulkClient } from '../../web/e2e/bulk-download-fixture';
import { encodeBulkRelay } from '../../../shared/remote-chat/bulkRelayWire';
import { downloadBulkClient } from '../../../shared/remote-chat/client/bulkClient';
import type { ChatLink } from '../../../shared/remote-chat/link';

export const nativeBulkStats = { batches: 0, acknowledged: 0, polls: 0 };

function encodeBatch(records: Uint8Array[], sequence: number) {
  const frames = records.map(record => encodeBulkRelay('fixture', record));
  const bytes = new Uint8Array(9 + frames.reduce((sum, frame) => sum + 4 + frame.length, 0));
  bytes.set([67, 71, 82, 49]); bytes[8] = frames.length;
  const view = new DataView(bytes.buffer); view.setUint32(4, sequence);
  let offset = 9;
  for (const frame of frames) {
    view.setUint32(offset, frame.length); offset += 4;
    bytes.set(frame, offset); offset += frame.length;
  }
  return bytes.buffer;
}

/** Use the production PC socket/decoder with a fake native callback and encrypted file source. */
export function nativeBulkFixture() {
  let events: Channel<ArrayBuffer> | undefined;
  const queued: Uint8Array[] = [];
  let pending = false;
  const source = fixtureBulkClient({ size: 8 * 1024 * 1024, revision: 'first', delay: 250, corrupt: false,
    offsets: [], bulk: true, recordBytes: 0, wireBytes: 0, cipherFailure: false });
  source.path('relay');
  const transport = source.client.transport()!;
  const receive = transport.receive.bind(transport);
  const flush = () => {
    if (pending || !events || !queued.length) return;
    pending = true;
    events.onmessage(encodeBatch(queued.splice(0, 16), ++nativeBulkStats.batches));
  };
  mockIPC((command, input) => {
    const args = input as { request: { bulkEvents?: Channel<ArrayBuffer>; bulk?: boolean };
      events?: Channel<unknown> };
    if (command === 'gui_remote_open') {
      events = args.request.bulkEvents;
      args.events!.onmessage({ sequence: 1, events: [{ type: 'message',
        data: JSON.stringify({ type: 'chat-policy', fileBulkV1: true }) }] });
    }
    if (command === 'gui_remote_ack' && args.request.bulk) {
      nativeBulkStats.acknowledged++; pending = false; queueMicrotask(flush);
    }
  });
  const socket = new NativeGuiSocket({ baseUrl: 'https://fixture.test', userId: 'owner' });
  socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', deviceId: 'office',
    publicKey: 'ab'.repeat(32) }));
  socket.onbulk = (session, bytes) => { if (session === 'fixture') receive(bytes, 'relay'); };
  transport.receive = bytes => { queued.push(bytes); queueMicrotask(flush); };
  const capability = downloadBulkClient({ peer: () => 'office', supported: () => true,
    link: () => ({ bulk: transport }) as ChatLink, request: async () => { throw new Error('unused'); } });
  source.client.available = () => socket.bulkAvailable && capability.available();
  window.setInterval(() => { nativeBulkStats.polls++; }, 20);
  return source.client;
}
