import { MAX_PORT_MAPPINGS, mappingConfig, readMapping, type MappingStorage, type PortMapping } from './settings';
import type { PortForwardingService } from './service';
import { MappingSyncPolling, type MappingSyncEnvironment } from './syncPolling';

export interface MappingDocument { revision: number; mappings: PortMapping[]; accepted?: boolean }
export type MappingExchange = (document?: MappingDocument) => Promise<MappingDocument>;
const SYNC_ERROR = '配置暂未同步，联网后会自动重试。';
const PROTOCOL_SYNC_ERROR = '协议设置暂未同步，本机映射仍可使用。';
const CAPACITY_CONFLICT = '最多同步 8 条映射，多出的映射已保留在本机。请删除不需要的映射后继续同步。';
type Pending = Record<string, PortMapping | null>;

/** Pending per-record edits survive restarts; compare-and-swap preserves unrelated concurrent edits. */
export class MappingSync {
  private pending: Pending;
  private busy = false;
  private disposed = false;
  private readonly polling: MappingSyncPolling;
  private generation = 0;
  private refreshRequested = false;
  private stopActivity?: () => void;
  private unsubscribe?: () => void;
  private status = '';
  private synced = false;
  private readonly listeners = new Set<() => void>();
  private readonly key: string;

  constructor(private readonly service: PortForwardingService, private readonly options: {
    scope: string; storage: MappingStorage; exchange: MappingExchange; environment?: MappingSyncEnvironment;
  }) {
    this.key = 'codex-port-mapping-sync:' + options.scope;
    this.pending = this.readPending();
    this.polling = new MappingSyncPolling(this.requestRefresh, options.environment);
  }

  snapshot = () => this.status;
  isSynced = () => this.synced;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start = () => {
    this.disposed = false;
    const generation = ++this.generation;
    this.service.applySaved(mergeMappings(this.service.snapshot(), this.pending));
    this.unsubscribe = this.service.subscribeChanges((id, value) => {
      this.pending[id] = value ? mappingConfig(value) : null;
      this.setStatus('配置正在同步…');
      this.persist();
      this.requestRefresh();
    });
    const activity = () => this.polling.setActive(this.service.snapshot().some(entry =>
      entry.enabled || entry.status === 'running' || entry.status === 'starting'));
    activity();
    this.stopActivity = this.service.subscribe(activity);
    this.polling.start();
    this.requestRefresh();
    return () => {
      if (generation !== this.generation) return;
      this.disposed = true;
      this.generation++;
      this.polling.stop();
      this.stopActivity?.();
      this.unsubscribe?.();
    };
  };

  /** Coalesce edits and recovery events arriving during a request into one follow-up. */
  requestRefresh = () => {
    if (this.disposed) return;
    if (this.busy) { this.refreshRequested = true; return; }
    void this.refresh();
  };

  refresh = async () => {
    if (this.busy || this.disposed) return;
    this.polling.begin();
    if (!this.polling.environment.snapshot().online) {
      this.setStatus(SYNC_ERROR);
      this.polling.finish(true, Object.keys(this.pending).length > 0);
      return;
    }
    this.busy = true;
    this.refreshRequested = false;
    const generation = this.generation;
    const obsolete = () => this.disposed || generation !== this.generation;
    let failed = false;
    let retryPending = false;
    try {
      retryPending = await this.synchronize(obsolete);
    } catch (error) {
      failed = true;
      if (!obsolete()) this.setStatus(error instanceof Error && error.message === PROTOCOL_SYNC_ERROR
        ? PROTOCOL_SYNC_ERROR : SYNC_ERROR);
    }
    finally {
      this.busy = false;
      if (!obsolete()) this.polling.finish(failed, retryPending);
      if (this.refreshRequested && !this.disposed) this.requestRefresh();
    }
  };

  private async synchronize(obsolete: () => boolean): Promise<boolean> {
    let remote = readMappingDocument(await this.options.exchange());
    if (obsolete()) return false;
    // A failed write must not prevent valid remote changes from reaching this device.
    this.service.applySaved(mergeMappings(remote.mappings, this.pending));
    const { sent, mappings } = planMappingUpload(remote.mappings, this.pending);
    if (Object.keys(sent).length) {
      remote = readMappingDocument(await this.options.exchange({ revision: remote.revision, mappings }));
      if (obsolete()) return false;
      if (remote.accepted) this.acknowledge({ sent, mappings, remote });
    }
    const persisted = this.persist();
    const visible = mergeMappings(remote.mappings, this.pending);
    this.service.applySaved(visible);
    if (persisted) this.updateStatus(visible);
    // Retry CAS conflicts promptly; capacity-only overflow waits for the normal discovery poll.
    return Object.keys(planMappingUpload(remote.mappings, this.pending).sent).length > 0;
  }

  private acknowledge({ sent, mappings, remote }: {
    sent: Pending; mappings: PortMapping[]; remote: MappingDocument;
  }) {
    // Older servers may accept unknown fields without storing them; never silently downgrade UDP.
    if (mappings.some(entry => entry.protocol && entry.protocol !== 'tcp'
      && remote.mappings.find(saved => saved.id === entry.id)?.protocol !== entry.protocol)) {
      throw new Error(PROTOCOL_SYNC_ERROR);
    }
    for (const [id, value] of Object.entries(sent)) {
      if (this.pending[id] === value) delete this.pending[id];
    }
  }

  private readPending(): Pending {
    try {
      const raw = this.options.storage.getItem(this.key);
      if (raw) {
        const data = JSON.parse(raw) as Pending;
        const pending: Pending = {};
        for (const [id, value] of Object.entries(data)) {
          if (!/^[\w-]{1,64}$/.test(id)) continue;
          const mapping = value && readMapping(value, () => id);
          if (value === null || mapping) pending[id] = mapping || null;
        }
        return pending;
      }
    } catch { this.setStatus(SYNC_ERROR); }
    return Object.fromEntries(this.service.snapshot().map(entry => [entry.id, mappingConfig(entry)]));
  }

  private updateStatus(visible: PortMapping[]) {
    if (visible.length > MAX_PORT_MAPPINGS) {
      this.setStatus(CAPACITY_CONFLICT);
      return;
    }
    const synced = Object.keys(this.pending).length === 0;
    this.setStatus(synced ? '配置已自动同步' : '配置正在同步…', synced);
  }

  private persist() {
    try { this.options.storage.setItem(this.key, JSON.stringify(this.pending)); return true; }
    catch { this.setStatus('配置未能保存到本机，请检查存储空间。'); return false; }
  }

  private setStatus(value: string, synced = false) {
    this.status = value;
    this.synced = synced;
    for (const listener of this.listeners) listener();
  }
}

function readMappingDocument(value: MappingDocument): MappingDocument {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Array.isArray(value.mappings) || value.mappings.length > MAX_PORT_MAPPINGS) {
    throw new Error('Invalid mapping document');
  }
  const ids = new Set<string>();
  const mappings = value.mappings.map(entry => {
    if (!entry || typeof entry.id !== 'string' || !/^[\w-]{1,64}$/.test(entry.id) || ids.has(entry.id)) {
      throw new Error('Invalid mapping ID');
    }
    const parsed = readMapping(entry, () => entry.id);
    if (!parsed) throw new Error('Invalid mapping target');
    ids.add(entry.id);
    return parsed;
  });
  return { revision: value.revision, mappings, accepted: value.accepted === true };
}

/** Apply edits/deletions first, then fill available slots; overflow remains in the durable pending queue. */
function planMappingUpload(remote: PortMapping[], pending: Pending): { sent: Pending; mappings: PortMapping[] } {
  const remoteIds = new Set(remote.map(entry => entry.id));
  const changes = Object.entries(pending);
  const sent = Object.fromEntries(changes.filter(([id, value]) => !value || remoteIds.has(id)));
  let mappings = mergeMappings(remote, sent);
  for (const [id, value] of changes) {
    if (!value || remoteIds.has(id)) continue;
    const candidate = mergeMappings(mappings, { [id]: value });
    if (candidate.length > MAX_PORT_MAPPINGS) continue;
    sent[id] = value;
    mappings = candidate;
  }
  return { sent, mappings };
}

export function mergeMappings(remote: PortMapping[], pending: Pending): PortMapping[] {
  const merged = new Map(remote.map(entry => [entry.id, mappingConfig(entry)]));
  for (const [id, entry] of Object.entries(pending)) {
    if (!entry) { merged.delete(id); continue; }
    // Import identical legacy local settings only once across installations.
    const duplicate = !merged.has(id) && [...merged.values()].some(value =>
      value.remoteHost === entry.remoteHost && value.remotePort === entry.remotePort && value.localPort === entry.localPort
      && (value.protocol ?? 'tcp') === (entry.protocol ?? 'tcp'));
    if (!duplicate) merged.set(id, entry);
  }
  return [...merged.values()];
}

export function mappingSyncScope(scope: string): { baseUrl: string; account: string; deviceId: string } | undefined {
  try {
    const parts: unknown = JSON.parse(scope);
    if (!Array.isArray(parts) || parts.length !== 3 || !parts.every(value => typeof value === 'string' && value)) return;
    return { baseUrl: parts[0], account: parts[1], deviceId: parts[2] };
  } catch { return; }
}
