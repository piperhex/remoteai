import { afterEach, expect, it, vi } from 'vitest';
import { DeviceMappingRuntime, type MappingConnection } from '../../../../shared/port-mapping/deviceRuntime';
import { DeviceMappingRegistry } from '../../../../shared/port-mapping/deviceRegistry';
import type { MappingDocument } from '../../../../shared/port-mapping/sync';
import type { MappingStorage } from '../../../../shared/port-mapping/settings';

const flush = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(stop => stop()); vi.useRealTimers(); });

it('only saves new mappings until their switch is enabled, including after restart', async () => {
  const fixture = setup();
  const runtime = await fixture.start('one');
  const id = runtime.service.save({ remotePort: 8080, localPort: 18080 });
  await flush();
  expect(runtime.service.snapshot()[0]).toMatchObject({ enabled: false, status: 'stopped' });
  expect(fixture.connections.get('one')!.start).not.toHaveBeenCalled();
  fixture.connections.get('one')!.setReady(true); await flush();
  expect(fixture.connections.get('one')!.files.openResource).not.toHaveBeenCalled();
  const restored = setup(fixture.saved, fixture.documents); const restoredRuntime = await restored.start('one');
  expect(restoredRuntime.service.snapshot()[0]).toMatchObject({ enabled: false, status: 'stopped' });
  expect(restored.connections.get('one')!.start).not.toHaveBeenCalled();
  await runtime.service.start(id); await flush();
  expect(fixture.connections.get('one')!.start).toHaveBeenCalledOnce();
  expect(runtime.service.snapshot()[0].status).toBe('running');
});

it('persists aliases separately without changing or uploading mapping configuration', async () => {
  const fixture = setup(); const runtime = await fixture.start('one');
  const id = runtime.service.save({ remotePort: 8080, localPort: 18080 }); await flush();
  const document = fixture.documents.get('one');
  const entries = runtime.service.snapshot();
  runtime.aliases.set(id, '  Development server  '); await flush();
  expect(runtime.aliases.get(id)).toBe('Development server');
  expect(runtime.service.snapshot()).toBe(entries);
  expect(fixture.documents.get('one')).toBe(document);
  expect(JSON.stringify(document)).not.toContain('Development server');
  const restored = await setup(fixture.saved, fixture.documents).start('one');
  expect(restored.aliases.get(id)).toBe('Development server');
  expect((await fixture.start('two')).aliases.get(id)).toBe('');
  restored.aliases.set(id, '');
  expect((await setup(fixture.saved, fixture.documents).start('one')).aliases.get(id)).toBe('');
});

it('discovers idle remote edits without opening a tunnel and refreshes immediately on reconnection', async () => {
  vi.useFakeTimers();
  const fixture = setup(); const runtime = await fixture.start('one');
  const mapping = { id: 'cloud', remotePort: 80, localPort: 8080 };
  fixture.documents.set('one', { revision: 1, mappings: [mapping] });
  await vi.advanceTimersByTimeAsync(59_999);
  expect(runtime.service.snapshot()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(runtime.service.snapshot()[0]).toMatchObject({ id: 'cloud', enabled: false });
  expect(fixture.connections.get('one')!.start).not.toHaveBeenCalled();
  fixture.documents.set('one', { revision: 2, mappings: [] });
  fixture.connections.get('one')!.setReady(true); await flush();
  expect(runtime.service.snapshot()).toEqual([]);
});

function setup(saved = new Map<string, string>(), documents = new Map<string, MappingDocument>()) {
  const storage: MappingStorage = { getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); } };
  const connections = new Map<string, ReturnType<typeof fakeConnection>>();
  let nextId = 0;
  const registry = new DeviceMappingRegistry((deviceId, owner) => {
    const connection = fakeConnection(); connections.set(deviceId, connection);
    return new DeviceMappingRuntime(connection, { storage, scope: deviceId, createId: () => `id-${++nextId}`,
      createTunnel: () => ({ resolve: vi.fn(async () => 'local'), close: vi.fn(async () => {}) }),
      validateTarget: (target, id) => owner.validateTarget(deviceId, target, id),
      exchange: async value => {
        if (value) documents.set(deviceId, value);
        return { ...(documents.get(deviceId) ?? { revision: 0, mappings: [] }), accepted: true };
      },
    });
  });
  const start = async (id: string) => {
    const runtime = registry.get(id); cleanup.push(runtime.start()); await flush(); return runtime;
  };
  return { registry, connections, start, saved, documents };
}

function fakeConnection() {
  let state = { ready: false, error: '' };
  const listeners = new Set<() => void>();
  const setReady = (ready: boolean) => { state = { ready, error: '' }; listeners.forEach(listener => listener()); };
  return {
    files: { openResource: vi.fn(async () => 'resource'), closeResource: vi.fn(async () => {}),
      link: vi.fn(async () => ({ type: 'done' as const })) },
    start: vi.fn(), stop: vi.fn(() => setReady(false)), setReady,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
  } satisfies MappingConnection & { setReady: (ready: boolean) => void };
}

it('connects only computers with enabled mappings and releases only the last mapping on that computer', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T00:00:00Z'));
  const fixture = setup();
  const first = await fixture.start('one'); const second = await fixture.start('two');
  expect(fixture.connections.get('one')!.start).not.toHaveBeenCalled();
  first.service.add(80, 8080); first.service.add(81, 8081);
  vi.setSystemTime(new Date('2026-10-30T00:00:01Z'));
  second.service.add(80, 8082);
  expect(fixture.connections.get('one')!.start).toHaveBeenCalledTimes(1);
  expect(fixture.connections.get('two')!.start).toHaveBeenCalledTimes(1);
  fixture.connections.forEach(connection => connection.setReady(true)); await flush();
  expect(first.service.snapshot().every(entry => entry.status === 'running')).toBe(true);
  await first.service.stop('id-1');
  expect(fixture.connections.get('one')!.stop).not.toHaveBeenCalled();
  await first.service.remove('id-2');
  expect(fixture.connections.get('one')!.stop).toHaveBeenCalledTimes(1);
  expect(second.service.snapshot()[0]).toMatchObject({ enabled: true, status: 'running' });
  expect(fixture.registry.snapshot().map(value => value.deviceId)).toEqual(['two', 'one']);
});

it('preserves enabled intent through disconnect, retries a failed mapping and respects a manual stop', async () => {
  vi.useFakeTimers();
  const fixture = setup(); const runtime = await fixture.start('one');
  const connection = fixture.connections.get('one')!;
  runtime.service.add(80, 8080); connection.setReady(true); await flush();
  connection.setReady(false); await flush();
  expect(runtime.service.snapshot()[0]).toMatchObject({ enabled: true, status: 'stopped' });
  connection.files.openResource.mockRejectedValueOnce(new Error('disconnected'));
  connection.setReady(true); await flush();
  expect(runtime.service.snapshot()[0]).toMatchObject({ enabled: true, status: 'error' });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(runtime.service.snapshot()[0]).toMatchObject({ enabled: true, status: 'running' });
  connection.setReady(false); await runtime.service.stop('id-1'); await flush();
  connection.setReady(true); await vi.advanceTimersByTimeAsync(5_000);
  expect(runtime.service.snapshot()[0]).toMatchObject({ enabled: false, status: 'stopped' });
});

it('restores local switches after restart without uploading them or importing another clients switch', async () => {
  const fixture = setup(); const runtime = await fixture.start('one');
  runtime.service.add(80, 8080); await flush();
  expect(fixture.documents.get('one')!.mappings[0]).not.toHaveProperty('enabled');
  const connection = fakeConnection();
  const restored = new DeviceMappingRuntime(connection, { scope: 'one',
    storage: { getItem: key => fixture.saved.get(key) ?? null, setItem: (key, value) => fixture.saved.set(key, value) },
    createId: () => 'restored', createTunnel: () => ({ resolve: async () => '', close: async () => {} }),
    validateTarget: () => {}, exchange: async () => fixture.documents.get('one')!,
  });
  cleanup.push(restored.start()); await flush();
  expect(connection.start).toHaveBeenCalledOnce();
  expect(restored.service.snapshot()[0].enabled).toBe(true);
  restored.service.applySaved([...fixture.documents.get('one')!.mappings,
    { id: 'cloud', remotePort: 90, localPort: 8090 }]); await flush();
  expect(restored.service.snapshot().find(entry => entry.id === 'cloud')!.enabled).toBe(false);
});

it('rejects conflicting ports across devices while allowing separate TCP and UDP ports', async () => {
  const fixture = setup(); const first = await fixture.start('one'); const second = await fixture.start('two');
  first.service.add(80, 8080, '', 'tcp');
  expect(() => second.service.add(80, 8080)).toThrow('client.mappingHub.portConflict');
  expect(() => second.service.add(53, 8080, '', 'udp')).not.toThrow();
  expect(() => second.service.add(53, 8080, '', 'both')).toThrow('client.mappingHub.portConflict');
});

it('does not reconnect after teardown and never turns a stopped mapping back on during an edit', async () => {
  const fixture = setup(); const runtime = await fixture.start('one');
  const connection = fixture.connections.get('one')!;
  runtime.service.add(80, 8080); connection.setReady(true); await flush();
  const editing = runtime.service.edit('id-1', { remotePort: 81, localPort: 8081 });
  await runtime.service.stop('id-1'); await editing;
  expect(runtime.service.snapshot()[0]).toMatchObject({ enabled: false, status: 'stopped' });
  cleanup.pop()!();
  await runtime.service.start('id-1');
  expect(runtime.service.snapshot()[0].enabled).toBe(false);
});
