import { describe, expect, it } from 'vitest';
import { BrowserMappingStore } from '../../../../../../shared/port-mapping/browserMappings';
import type { ForwardingEntry } from '../../../../../../shared/port-mapping/service';

function source(entries: ForwardingEntry[]) {
  const listeners = new Set<() => void>();
  return { snapshot: () => entries,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    replace: (next: ForwardingEntry[]) => { entries = next; listeners.forEach(listener => listener()); },
  };
}
const mapping = (id: string, extra: Partial<ForwardingEntry> = {}): ForwardingEntry => ({
  id, localPort: 18080, remotePort: 8080, status: 'running', ...extra,
});

describe('browser mapping index', () => {
  it('exposes only active TCP addresses and follows stop, disconnect and disposal', () => {
    const store = new BrowserMappingStore();
    const service = source([mapping('tcp'), mapping('udp', { protocol: 'udp' }),
      mapping('both', { protocol: 'both', localPort: 18081 }), mapping('stopped', { status: 'stopped' }),
      mapping('starting', { status: 'starting' }), mapping('error', { status: 'error' })]);
    const unregister = store.register('computer', service);
    expect(store.snapshot().map(entry => entry.url)).toEqual(['http://127.0.0.1:18080/', 'http://127.0.0.1:18081/']);
    service.replace([mapping('tcp', { status: 'stopping' })]);
    expect(store.snapshot()).toEqual([]);
    service.replace([mapping('tcp')]); unregister();
    expect(store.snapshot()).toEqual([]);
    service.replace([mapping('tcp')]);
    expect(store.snapshot()).toEqual([]);
  });

  it('keeps another computer registered when an old instance is removed', () => {
    const store = new BrowserMappingStore();
    const first = source([mapping('same')]), second = source([mapping('same', { localPort: 18082 })]);
    const unregister = store.register('first', first);
    store.register('second', second);
    expect(new Set(store.snapshot().map(entry => entry.id)).size).toBe(2);
    unregister();
    expect(store.snapshot().map(entry => entry.url)).toEqual(['http://127.0.0.1:18082/']);
  });
});
