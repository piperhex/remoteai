import { expect, it, vi } from 'vitest';
import { LoungeAttachmentManager } from '../../../../shared/lounge/attachmentManager';
import { imageAttachmentSource } from '../../../../shared/lounge/imageAttachmentSource';
import type { AttachmentImageStore } from '../../../../shared/lounge/attachmentCache';
import type { AttachmentSource } from '../../../../shared/lounge/attachments';

const connections = vi.hoisted(() => [] as { source: (id: string) => Promise<AttachmentSource | undefined> }[]);
vi.mock('../../../../shared/lounge/attachmentConnection', () => ({ AttachmentConnection: class {
  constructor(options: typeof connections[number]) { connections.push(options); }
  start() {} stop() {}
} }));

function imageStore() {
  const data = new Map<string, string>();
  const store: AttachmentImageStore = {
    get: vi.fn(async id => data.get(id)), put: vi.fn(async (id, uri) => { data.set(id, uri); }),
    remove: async id => { data.delete(id); },
    source: async id => data.has(id) ? imageAttachmentSource(data.get(id)!) : undefined,
    sink: async file => {
      const chunks: Buffer[] = [];
      return { write: async chunk => { chunks.push(Buffer.from(chunk, 'base64')); }, abort: async () => {},
        finish: async () => `data:${file.mime};base64,${Buffer.concat(chunks).toString('base64')}` };
    },
  };
  return store;
}
function manager(store: AttachmentImageStore, randomId: () => string = () => crypto.randomUUID()) {
  return new LoungeAttachmentManager({ randomId, session: {
    baseUrl: 'https://lounge.test', authorize: async () => ({ ticket: 'test' }), attachmentImages: store,
    sync: { randomBytes: length => new Uint8Array(length), createPeer: vi.fn() },
  } });
}

it('archives outgoing images before publication and serves them after a different runtime device restarts', async () => {
  const store = imageStore(), sender = manager(store);
  sender.ready(true);
  const uri = `data:image/png;base64,${Buffer.alloc(400_001, 149).toString('base64')}`;
  const file = sender.prepare({ text: '', images: [uri], to: 'recipient' }).attachments![0];
  await sender.persistImages([file]);
  expect(await store.get(file.id)).toBe(uri);
  sender.stop();
  const restarted = manager(store);
  expect(restarted.device).not.toBe(file.device);
  const source = await connections.at(-1)!.source(file.id);
  expect(source?.size).toBe(file.size);
  expect(await source?.read(262144, 7)).toBe(Buffer.alloc(7, 149).toString('base64'));
  const reader = await restarted.openReader(file);
  expect(await reader.read(1, 4)).toBe(Buffer.alloc(4, 149).toString('base64'));
  reader.close(); restarted.stop();
});

it('reports storage failures before publication and allows a successful retry', async () => {
  const store = imageStore(), sender = manager(store);
  sender.ready(true);
  const file = sender.prepare({ text: '', images: ['data:image/png;base64,AQIDBA=='] }).attachments![0];
  vi.mocked(store.put).mockRejectedValueOnce(new Error('quota'));
  await expect(sender.persistImages([file])).rejects.toThrow('quota');
  await sender.persistImages([file]);
  expect(await store.get(file.id)).toBe('data:image/png;base64,AQIDBA==');
  sender.stop();
});

it('restores previously received cache entries and isolates another account without guessing a source', async () => {
  const store = imageStore();
  await store.put('legacy-image', 'data:image/png;base64,AQIDBA==');
  const sender = manager(store);
  expect(await connections.at(-1)!.source('legacy-image')).toBeDefined();
  const other = manager(imageStore());
  expect(await connections.at(-1)!.source('legacy-image')).toBeUndefined();
  sender.stop(); other.stop();
});

it('releases outgoing image sources and shares only pending reads across the signed-in session', async () => {
  const store = imageStore(), sender = manager(store);
  sender.ready(true);
  const uri = 'data:image/png;base64,AQIDBA==';
  for (let i = 0; i < 120; i++) {
    const [file] = sender.prepare({ text: '', images: [uri] }).attachments!;
    await sender.persistImages([file]);
    const pending = sender.image(file);
    expect(sender.image(file)).toBe(pending);
    await pending;
    await store.remove!(file.id);
    expect(await connections.at(-1)!.source(file.id)).toBeUndefined();
    await store.put(file.id, 'file:///restored-image');
    expect(await sender.image(file)).toBe('file:///restored-image');
  }
  sender.stop();
});

it('validates the entire draft before registering any file and rolls back failed multi-image persistence', async () => {
  const ids: string[] = [];
  const store = imageStore(), sender = manager(store, () => { const id = crypto.randomUUID(); ids.push(id); return id; });
  sender.ready(true);
  const uri = 'data:image/png;base64,AQIDBA==';
  const file = { mime: 'text/plain', size: 4, name: '../bad', read: async () => 'AQIDBA==' };
  expect(() => sender.prepare({ text: '', to: 'peer', images: [uri], files: [file] })).toThrow();
  expect(await connections.at(-1)!.source(ids[1])).toBeUndefined();
  const created = sender.prepare({ text: '', images: [uri, uri] }).attachments!;
  vi.mocked(store.put).mockRejectedValueOnce(new Error('quota'));
  await expect(sender.persistImages(created, created)).rejects.toThrow('quota');
  sender.discardUnpublished(created);
  for (const { id } of created) {
    expect(await store.get(id)).toBeUndefined();
    expect(await connections.at(-1)!.source(id)).toBeUndefined();
  }
  sender.stop();
});

it('drops only deleted sources and lets a reader finish after deleting its message', async () => {
  const sender = manager(imageStore());
  sender.ready(true);
  const source = { name: 'test.txt', mime: 'text/plain', size: 4, read: async () => 'AQIDBA==' };
  const publish = (peer: string, time: number) => {
    const files = sender.prepare({ text: '', images: [], files: [source], to: peer }).attachments!;
    sender.published({ attachments: files, conversation: peer, sentAt: new Date(time).toISOString() });
    return files[0];
  };
  const first = publish('peer', 10), second = publish('peer', 12), other = publish('other', 9);
  const reader = await sender.openReader(first);
  sender.removeBefore('peer', 10);
  const get = connections.at(-1)!.source;
  expect(await get(first.id)).toBeUndefined();
  expect(await get(second.id)).toBe(source);
  expect(await get(other.id)).toBe(source);
  expect(await reader.read(0, 4)).toBe('AQIDBA==');
  reader.close(); sender.stop();
});
