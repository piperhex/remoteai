import type { MappingConsumer } from '../../../../shared/remote-chat/files';

interface ActiveConsumer extends MappingConsumer { mappingId: string; origin: string; name: string }
const active = new Set<ActiveConsumer>();
const subscribers = new Set<() => void>();
let snapshot: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();
const key = (id: string, origin: string) => JSON.stringify([id, origin]);
const empty: ReadonlyMap<string, string> = new Map();

function publish() {
  const next = new Map<string, Map<string, string>>();
  for (const consumer of active) {
    const id = key(consumer.mappingId, consumer.origin);
    const devices = next.get(id) ?? new Map<string, string>();
    devices.set(consumer.deviceId, consumer.name);
    next.set(id, devices);
  }
  snapshot = next;
  subscribers.forEach(listener => listener());
}

export const mappingConsumers = {
  devices: (id: string, origin: string) => snapshot.get(key(id, origin)) ?? empty,
  subscribe(listener: () => void) {
    subscribers.add(listener);
    return () => { subscribers.delete(listener); };
  },
  track(consumer: ActiveConsumer) {
    active.add(consumer);
    publish();
    return () => { if (active.delete(consumer)) publish(); };
  },
};
