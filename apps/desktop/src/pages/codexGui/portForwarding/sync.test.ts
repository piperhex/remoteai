import { afterEach, expect, it, vi } from 'vitest';
import { MappingSync, type MappingDocument } from '../../../../../../shared/port-mapping/sync';
import { PortForwardingService } from '../../../../../../shared/port-mapping/service';
import { MAX_PORT_MAPPINGS, readPortMappings, savePortMappings,
  type MappingStorage, type PortMapping } from '../../../../../../shared/port-mapping/settings';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); vi.useRealTimers(); });
const flush = async () => { for (let count = 0; count < 40; count++) await Promise.resolve(); };
const storage = (): MappingStorage => {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
};
function server(mappings: PortMapping[] = []) {
  let doc: MappingDocument = { revision: 0, mappings };
  const exchange = vi.fn(async (input?: MappingDocument) => {
    if (!input) return structuredClone(doc);
    if (input.mappings.length > MAX_PORT_MAPPINGS) throw new Error('Invalid port mapping configuration');
    if (input.revision !== doc.revision) return { ...structuredClone(doc), accepted: false };
    doc = { revision: doc.revision + 1, mappings: structuredClone(input.mappings) };
    return { ...structuredClone(doc), accepted: true };
  });
  return { exchange, document: () => doc };
}
function device(options: { exchange: ReturnType<typeof server>['exchange']; cache?: MappingStorage;
  saved?: PortMapping[]; scope?: string }) {
  const service = new PortForwardingService({ openResource: async () => 'resource',
    closeResource: async () => {}, link: async () => ({ type: 'done' }) }, options.saved ?? [],
  { createId: () => crypto.randomUUID(), createTunnel: () => ({ resolve: async (_id, url) => url, close: async () => {} }) });
  const sync = new MappingSync(service, { scope: options.scope ?? 'account/computer',
    storage: options.cache ?? storage(), exchange: options.exchange });
  const stop = sync.start();
  cleanup.push(stop, service.dispose);
  return { service, sync, stop };
}

it('syncs additions, protocols, stable IDs, edits and removals between phone, desktop and Web', async () => {
  const cloud = server();
  const phone = device(cloud), desktop = device(cloud), web = device(cloud);
  await flush();
  expect(phone.sync.isSynced()).toBe(true);
  phone.service.setConnected(true);
  phone.service.add(3000, 13000, '192.168.1.20', 'udp');
  expect(phone.sync.isSynced()).toBe(false);
  await flush();
  expect(phone.sync.isSynced()).toBe(true);
  await desktop.sync.refresh(); await web.sync.refresh();
  const original = phone.service.snapshot()[0];
  expect(desktop.service.snapshot()[0].protocol).toBe('udp');
  expect(web.service.snapshot()[0].protocol).toBe('udp');
  expect(desktop.service.snapshot()[0]).toMatchObject({ id: original.id, status: 'stopped', remoteHost: '192.168.1.20' });
  await desktop.service.edit(original.id, { remoteHost: '::1', remotePort: 8080, localPort: 18080, protocol: 'both' });
  await flush(); await phone.sync.refresh(); await web.sync.refresh(); await flush();
  expect(phone.service.snapshot()[0]).toMatchObject({ id: original.id, status: 'running', remotePort: 8080 });
  expect(web.service.snapshot()[0]).toMatchObject({ id: original.id, status: 'stopped', remoteHost: '::1' });
  expect(phone.service.snapshot()[0].protocol).toBe('both');
  await web.service.remove(original.id); await flush(); await phone.sync.refresh(); await desktop.sync.refresh();
  expect(phone.service.snapshot()).toEqual([]);
  expect(desktop.service.snapshot()).toEqual([]);
});

it('retains UDP locally and retries when an older server silently drops the protocol field', async () => {
  const cloud = server();
  const cache = storage();
  let legacy = true;
  const exchange = vi.fn(async (input?: MappingDocument) => cloud.exchange(input && legacy
    ? { ...input, mappings: input.mappings.map(({ protocol: _protocol, ...entry }) => entry) } : input));
  const phone = device({ exchange, cache });
  await flush();
  phone.service.setConnected(true); phone.service.add(53, 1053, '', 'udp'); await flush();
  expect(phone.service.snapshot()[0]).toMatchObject({ protocol: 'udp', status: 'running' });
  expect(phone.sync.snapshot()).toContain('协议设置暂未同步');
  expect(phone.sync.isSynced()).toBe(false);
  phone.stop();
  const restarted = device({ exchange, cache, saved: phone.service.snapshot() });
  await flush();
  expect(restarted.service.snapshot()[0].protocol).toBe('udp');
  legacy = false; await restarted.sync.refresh();
  expect(restarted.sync.snapshot()).toBe('配置已自动同步');
  expect(restarted.sync.isSynced()).toBe(true);
  expect((await cloud.exchange()).mappings[0].protocol).toBe('udp');
});

const sevenMappings = () => Array.from({ length: 7 }, (_, index) => ({
  id: `base-${index}`, remoteHost: '127.0.0.1', remotePort: 3000 + index, localPort: 13000 + index,
}));

it('keeps both simultaneous eighth mappings, avoids invalid retries and still syncs unrelated edits', async () => {
  vi.useFakeTimers();
  const cloud = server(sevenMappings()), first = device(cloud), second = device(cloud);
  await flush();
  first.service.add(4000, 14000); second.service.add(5000, 15000); await flush();
  await second.sync.refresh();
  expect(cloud.document().mappings).toHaveLength(MAX_PORT_MAPPINGS);
  expect(second.service.snapshot()).toHaveLength(9);
  expect(second.sync.snapshot()).toContain('多出的映射已保留在本机');
  const uploads = () => cloud.exchange.mock.calls.filter(([input]) => input !== undefined);
  const uploadCount = uploads().length;
  const requestCount = cloud.exchange.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(uploads()).toHaveLength(uploadCount);
  expect(cloud.exchange).toHaveBeenCalledTimes(requestCount);
  expect(uploads().every(([input]) => input!.mappings.length <= MAX_PORT_MAPPINGS)).toBe(true);
  await first.service.edit('base-0', { remotePort: 6000, localPort: 16000 }); await flush();
  await second.sync.refresh();
  expect(second.service.snapshot().find(entry => entry.id === 'base-0')?.remotePort).toBe(6000);
  await second.service.edit('base-1', { remotePort: 7000, localPort: 17000 }); await flush();
  expect(cloud.document().mappings.find(entry => entry.id === 'base-1')?.remotePort).toBe(7000);
  expect(second.service.snapshot()).toHaveLength(9);
  expect(second.sync.snapshot()).toContain('多出的映射已保留在本机');
  await second.service.remove('base-2'); await flush(); await first.sync.refresh();
  expect(second.sync.snapshot()).toBe('配置已自动同步');
  expect(cloud.document().mappings.map(entry => entry.remotePort)).toContain(5000);
  expect(first.service.snapshot().map(entry => entry.id).sort())
    .toEqual(second.service.snapshot().map(entry => entry.id).sort());
});

it('preserves overflow across an offline restart and resumes when another client frees capacity', async () => {
  const cloud = server(sevenMappings()), cache = storage();
  let offline = false;
  const exchange = vi.fn(async (input?: MappingDocument) => {
    if (offline) throw new Error('offline');
    return cloud.exchange(input);
  });
  const first = device(cloud), second = device({ exchange, cache }); await flush();
  first.service.add(4000, 14000); second.service.add(5000, 15000); await flush();
  await second.sync.refresh();
  savePortMappings('account/computer', second.service.snapshot(), cache);
  second.stop(); offline = true;
  const restarted = device({ exchange, cache, saved: readPortMappings('account/computer', cache) });
  await flush();
  expect(restarted.service.snapshot()).toHaveLength(9);
  expect(restarted.service.snapshot().map(entry => entry.remotePort)).toEqual(expect.arrayContaining([4000, 5000]));
  await first.service.remove('base-0'); await flush();
  offline = false; await restarted.sync.refresh();
  expect(restarted.sync.snapshot()).toBe('配置已自动同步');
  expect(restarted.service.snapshot()).toHaveLength(MAX_PORT_MAPPINGS);
  expect(cloud.document().mappings.map(entry => entry.remotePort)).toContain(5000);
  expect(JSON.parse(cache.getItem('codex-port-mapping-sync:account/computer')!)).toEqual({});
});

it('applies newly fetched remote entries even if an otherwise valid local write fails', async () => {
  const cloud = server(sevenMappings()), first = device(cloud), second = device({
    exchange: vi.fn(async (input?: MappingDocument) => {
      if (input) throw new Error('write unavailable');
      return cloud.exchange();
    }),
  });
  await flush();
  first.service.add(4000, 14000); await flush();
  second.service.add(5000, 15000);
  await second.service.edit('base-0', { remotePort: 6000, localPort: 16000 }); await flush();
  expect(second.sync.snapshot()).toContain('暂未同步');
  expect(second.service.snapshot()).toHaveLength(9);
  expect(second.service.snapshot().map(entry => entry.remotePort)).toEqual(expect.arrayContaining([4000, 5000, 6000]));
});

it('merges concurrent additions without losing unrelated records and retries a stale revision', async () => {
  const cloud = server(), first = device(cloud), second = device(cloud);
  await flush();
  first.service.add(3000, 13000); second.service.add(4000, 14000); await flush();
  await first.sync.refresh(); await second.sync.refresh(); await first.sync.refresh();
  expect(cloud.document().mappings.map(entry => entry.remotePort).sort()).toEqual([3000, 4000]);
  expect(first.service.snapshot()).toHaveLength(2);
  expect(second.service.snapshot()).toHaveLength(2);
});

it('retains an edit made while a write is in flight', async () => {
  const cloud = server(); let finish!: () => void;
  const exchange = vi.fn(async (input?: MappingDocument) => {
    if (input && !finish) await new Promise<void>(resolve => { finish = resolve; });
    return cloud.exchange(input);
  });
  const first = device({ exchange }); await flush();
  first.service.add(3000, 13000); await flush();
  await first.service.edit(first.service.snapshot()[0].id, { remotePort: 4000, localPort: 14000 });
  finish(); await flush(); await first.sync.refresh();
  expect(cloud.document().mappings[0].remotePort).toBe(4000);
});

it('persists offline deletions and does not resurrect them after a stale client restarts', async () => {
  const cloud = server(), cache = storage(); let offline = false;
  const exchange = vi.fn(async (input?: MappingDocument) => {
    if (offline) throw new Error('offline');
    return cloud.exchange(input);
  });
  const first = device({ exchange, cache }); await flush();
  first.service.add(3000, 13000); await flush();
  const stale = device(cloud); await flush();
  const staleSaved = stale.service.snapshot(); stale.stop();
  offline = true;
  await first.service.remove(first.service.snapshot()[0].id); await flush(); first.stop();
  expect(first.sync.snapshot()).toContain('暂未同步');
  offline = false;
  const resumed = device({ exchange, cache }); await flush();
  expect(cloud.document().mappings).toEqual([]);
  const staleCache = storage(); staleCache.setItem('codex-port-mapping-sync:account/computer', '{}');
  const reopened = device({ exchange, cache: staleCache, saved: staleSaved }); await flush();
  expect(reopened.service.snapshot()).toEqual([]);
  expect(resumed.service.snapshot()).toEqual([]);
});

it('ignores delayed replies after disposal and keeps polling single-flight', async () => {
  let resolve!: (document: MappingDocument) => void;
  const exchange = vi.fn(() => new Promise<MappingDocument>(done => { resolve = done; }));
  const current = device({ exchange });
  await current.sync.refresh(); await current.sync.refresh();
  expect(exchange).toHaveBeenCalledTimes(1);
  current.stop(); resolve({ revision: 1, mappings: [{ id: 'old-user', remotePort: 80, localPort: 8080 }] });
  await flush(); expect(current.service.snapshot()).toEqual([]);
});

it('restores pending offline edits even when the last visible cache was not written', async () => {
  const cache = storage();
  cache.setItem('codex-port-mapping-sync:account/computer', JSON.stringify({
    old: null, edited: { id: 'edited', remoteHost: '127.0.0.1', remotePort: 8080, localPort: 18080 },
  }));
  const exchange = vi.fn(async (): Promise<MappingDocument> => { throw new Error('offline'); });
  const current = device({ cache, exchange, saved: [{ id: 'old', remotePort: 3000, localPort: 13000 }] });
  await flush();
  expect(current.service.snapshot()).toMatchObject([{ id: 'edited', remotePort: 8080, status: 'stopped' }]);
});

it('does not acknowledge pending changes from an invalid server response', async () => {
  const cloud = server(); let corrupt = true;
  const exchange = vi.fn(async (input?: MappingDocument) => {
    if (input && corrupt) return { revision: 1, mappings: [{ id: 'invalid', remotePort: 0, localPort: 0 }], accepted: true };
    return cloud.exchange(input);
  });
  const current = device({ exchange }); await flush();
  current.service.add(3000, 13000); await flush();
  expect(current.sync.snapshot()).toContain('暂未同步');
  expect(current.service.snapshot()[0].remotePort).toBe(3000);
  corrupt = false; await current.sync.refresh();
  expect(cloud.document().mappings[0].remotePort).toBe(3000);
});
