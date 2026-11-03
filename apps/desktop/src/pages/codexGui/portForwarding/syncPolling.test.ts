import { afterEach, expect, it, vi } from 'vitest';
import { MappingSync, type MappingDocument } from '../../../../../../shared/port-mapping/sync';
import { PortForwardingService } from '../../../../../../shared/port-mapping/service';
import type { MappingSyncEnvironment } from '../../../../../../shared/port-mapping/syncPolling';

const cleanup: (() => void)[] = [];
const flush = async () => { for (let count = 0; count < 50; count++) await Promise.resolve(); };
afterEach(() => { cleanup.splice(0).forEach(stop => stop()); vi.useRealTimers(); });
const mapping = { id: 'one', remoteHost: '127.0.0.1', remotePort: 80, localPort: 8080 };

function fixture() {
  vi.useFakeTimers();
  let state = { online: true, foreground: true };
  const listeners = new Set<() => void>();
  const environment: MappingSyncEnvironment = {
    snapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const setState = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch }; listeners.forEach(listener => listener());
  };
  const values = new Map<string, string>([['codex-port-mapping-sync:fixture', '{}']]);
  let remote: MappingDocument = { revision: 0, mappings: [] };
  const exchange = vi.fn(async (input?: MappingDocument) => {
    if (input && input.revision === remote.revision) {
      remote = { revision: remote.revision + 1, mappings: structuredClone(input.mappings) };
      return { ...remote, accepted: true };
    }
    return structuredClone(remote);
  });
  const service = new PortForwardingService({ openResource: async () => 'resource',
    closeResource: async () => {}, link: async () => ({ type: 'done' }) }, [], {
    createId: () => 'local', enabledIds: [],
    createTunnel: () => ({ resolve: async () => '', close: async () => {} }),
  });
  const sync = new MappingSync(service, { scope: 'fixture', environment, exchange,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
  });
  const stop = sync.start(); cleanup.push(stop, service.dispose);
  return { service, sync, exchange, setState, stop, values, listeners,
    setRemote: (mappings: MappingDocument['mappings']) => { remote = { revision: remote.revision + 1, mappings }; } };
}

it('polls idle devices once per minute and still discovers another client without a tunnel', async () => {
  const current = fixture(); await flush();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(current.exchange).toHaveBeenCalledTimes(1);
  current.setRemote([mapping]);
  await vi.advanceTimersByTimeAsync(1);
  expect(current.exchange).toHaveBeenCalledTimes(2);
  expect(current.service.snapshot()[0]).toMatchObject({ id: 'one', enabled: false, status: 'stopped' });
});

it('uses a 30 second active cadence and refreshes immediately when a mapping is reenabled', async () => {
  const current = fixture(); await flush();
  current.setRemote([mapping]); await current.sync.refresh();
  await current.service.start('one'); await flush();
  current.exchange.mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(current.exchange).toHaveBeenCalledTimes(1);
  await current.service.stop('one'); await flush();
  current.exchange.mockClear();
  await vi.advanceTimersByTimeAsync(59_000);
  expect(current.exchange).not.toHaveBeenCalled();
  await current.service.start('one'); await flush();
  expect(current.exchange).toHaveBeenCalledTimes(1);
});

it('backs off in the background, keeps remote discovery and refreshes on foreground recovery', async () => {
  const current = fixture(); await flush();
  current.setState({ foreground: false }); current.exchange.mockClear();
  await vi.advanceTimersByTimeAsync(119_999);
  expect(current.exchange).not.toHaveBeenCalled();
  current.setRemote([mapping]);
  await vi.advanceTimersByTimeAsync(1);
  expect(current.service.snapshot()[0].id).toBe('one');
  current.setRemote([]); current.setState({ foreground: true }); await flush();
  expect(current.exchange).toHaveBeenCalledTimes(2);
  expect(current.service.snapshot()).toEqual([]);
});

it('persists edits while offline and uploads immediately on network recovery', async () => {
  const current = fixture(); await flush();
  current.setState({ online: false }); current.exchange.mockClear();
  current.service.save({ remotePort: 80, localPort: 8080 }); await flush();
  await vi.advanceTimersByTimeAsync(360_000);
  expect(current.exchange).not.toHaveBeenCalled();
  expect(JSON.parse(current.values.get('codex-port-mapping-sync:fixture')!)).toHaveProperty('local');
  current.setState({ online: true }); await flush();
  expect(current.exchange).toHaveBeenCalledTimes(2);
  expect(current.sync.isSynced()).toBe(true);
});

it('bounds failed HTTP retries at 120 seconds and resets the delay after recovery', async () => {
  const current = fixture(); await flush();
  current.exchange.mockRejectedValue(new Error('offline'));
  await current.sync.refresh(); current.exchange.mockClear();
  for (const delay of [5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000]) {
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(current.exchange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(current.exchange).toHaveBeenCalledTimes(1);
    current.exchange.mockClear();
  }
  current.exchange.mockResolvedValue({ revision: 0, mappings: [] });
  current.setState({ foreground: false }); current.setState({ foreground: true }); await flush();
  current.exchange.mockClear();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(current.exchange).toHaveBeenCalledTimes(1);
});

it('keeps one request in flight and follows up promptly with edits made during that request', async () => {
  const current = fixture(); await flush();
  let finish!: (value: MappingDocument) => void;
  current.exchange.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const inFlight = current.sync.refresh();
  current.exchange.mockClear();
  current.service.save({ remotePort: 80, localPort: 8080 });
  current.setState({ foreground: false }); current.setState({ foreground: true });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(current.exchange).not.toHaveBeenCalled();
  finish({ revision: 0, mappings: [] }); await inFlight; await flush();
  expect(current.sync.isSynced()).toBe(true);
  expect(current.exchange.mock.calls.filter(([input]) => input)).toHaveLength(1);
});

it('ignores a pre-disposal reply after restarting the same sync instance and removes timers/listeners', async () => {
  const current = fixture(); await flush();
  let finish!: (value: MappingDocument) => void;
  current.exchange.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const inFlight = current.sync.refresh();
  current.stop();
  const stop = current.sync.start(); cleanup.push(stop);
  finish({ revision: 99, mappings: [mapping] }); await inFlight; await flush();
  expect(current.service.snapshot()).toEqual([]);
  stop(); current.exchange.mockClear();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(current.exchange).not.toHaveBeenCalled();
  expect(current.listeners.size).toBe(0);
});
