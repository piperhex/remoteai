import { PortForwardingService, type ForwardingClient } from './service';
import { readPortMappings, savePortMappings, type MappingStorage, type PortMapping } from './settings';
import { MappingSync, type MappingExchange } from './sync';
import type { TunnelFactory } from './types';
import { LocalMappingAliases } from './localAliases';
import type { MappingSyncEnvironment } from './syncPolling';

export interface MappingConnection {
  files: ForwardingClient;
  start(): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
  snapshot(): { ready: boolean; error: string };
}

export class DeviceMappingRuntime {
  readonly service: PortForwardingService;
  readonly sync: MappingSync;
  readonly aliases: LocalMappingAliases;
  private disconnect?: () => void;
  private stopSync?: () => void;
  private unsubscribe?: () => void;
  private demanded = false;
  private readonly enabledKey: string;

  constructor(readonly connection: MappingConnection, private readonly options: {
    scope: string; storage: MappingStorage; createId: () => string; createTunnel: TunnelFactory;
    exchange: MappingExchange; validateTarget: (target: Omit<PortMapping, 'id'>, id?: string) => void;
    environment?: MappingSyncEnvironment;
  }) {
    this.enabledKey = 'codex-port-mapping-enabled:' + options.scope;
    this.aliases = new LocalMappingAliases(options.storage, options.scope);
    this.service = new PortForwardingService(connection.files,
      readPortMappings(options.scope, options.storage, options.createId), {
        ...options, enabledIds: this.readEnabled(),
      });
    this.sync = new MappingSync(this.service, options);
  }

  start = () => {
    this.service.activate();
    this.demanded = false;
    let ready = this.connection.snapshot().ready;
    this.disconnect = this.connection.subscribe(() => {
      const next = this.connection.snapshot().ready;
      this.service.setConnected(next);
      if (next && !ready) this.sync.requestRefresh();
      ready = next;
    });
    this.unsubscribe = this.service.subscribe(this.reconcile);
    this.stopSync = this.sync.start();
    this.reconcile();
    return this.dispose;
  };

  private reconcile = () => {
    const entries = this.service.snapshot();
    savePortMappings(this.options.scope, entries, this.options.storage);
    try {
      this.options.storage.setItem(this.enabledKey, JSON.stringify(entries.filter(entry => entry.enabled)
        .map(entry => entry.id)));
    } catch { console.warn('Port mapping switches could not be saved'); }
    // Finish listener cleanup before releasing the last connection.
    const demanded = entries.some(entry => entry.enabled || ['running', 'starting', 'stopping'].includes(entry.status));
    if (demanded === this.demanded) return;
    this.demanded = demanded;
    if (demanded) this.connection.start();
    else this.connection.stop();
  };

  private readEnabled(): string[] {
    try {
      const value: unknown = JSON.parse(this.options.storage.getItem(this.enabledKey) ?? '[]');
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  }

  private dispose = () => {
    this.stopSync?.();
    this.unsubscribe?.();
    this.disconnect?.();
    this.service.dispose();
    this.connection.stop();
  };
}
