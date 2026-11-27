import { invoke } from '@tauri-apps/api/core';
import { createMappingConnection } from '../../../../../shared/port-mapping/connection';
import { browserMappings } from '../../../../../shared/port-mapping/browserMappings';
import { LocalMappingAliases } from '../../../../../shared/port-mapping/localAliases';
import { MappingSync, type MappingDocument } from '../../../../../shared/port-mapping/sync';
import { readPortMappings, savePortMappings, type PortMapping } from '../../../../../shared/port-mapping/settings';
import type { MappingConnection } from '../../../../../shared/port-mapping/deviceRuntime';
import type { GuiCloudIdentity } from '../../../../../shared/conversation/remote/types';
import { desktopChatConnection } from '../codexGui/remote/desktopChatConnection';
import { PortForwardingService } from '../codexGui/portForwarding/service';
import type { MappingConsumer } from '../../../../../shared/remote-chat/files';
import { registerLocalBrowserMappings } from './localBrowserMappings';

const CONNECT_TIMEOUT_MS = 30_000;

interface SessionOptions {
  identity: GuiCloudIdentity;
  deviceId: string;
  local: boolean;
  consumer: () => MappingConsumer | undefined;
  validate: (target: Omit<PortMapping, 'id'>, id?: string) => void;
}

/** Keep chat history out of mapping sessions. Only a user's start action opens a peer connection. */
export class DesktopMappingSession {
  readonly service: PortForwardingService;
  readonly sync: MappingSync;
  readonly aliases: LocalMappingAliases;
  readonly scope: string;
  readonly local: boolean;
  private pending = new Set<(ready: boolean) => void>();
  private demanded = false;
  private ready = false;
  private online = false;
  private resourceCount = 0;

  private readonly peer?: MappingConnection;

  constructor(options: SessionOptions) {
    const { identity, deviceId, validate } = options;
    this.local = options.local;
    const peer = options.local ? undefined
      : createMappingConnection(events => desktopChatConnection(identity, deviceId, events));
    this.peer = peer;
    this.scope = JSON.stringify([identity.baseUrl, identity.userId, deviceId]);
    this.aliases = new LocalMappingAliases(localStorage, this.scope);
    this.service = new PortForwardingService(peer ? { ...peer.files,
      openResource: async url => {
        await this.waitForConnection();
        this.resourceCount++;
        try { return await peer.files.openResource(url); }
        catch (error) { this.resourceCount--; this.releaseIfIdle(); throw error; }
      },
      closeResource: async id => {
        try { await peer.files.closeResource(id); }
        finally { this.resourceCount--; this.releaseIfIdle(); }
      },
    } : null, readPortMappings(this.scope), validate, options.consumer);
    this.sync = new MappingSync(this.service, { scope: this.scope, storage: localStorage,
      exchange: (document?: MappingDocument) => invoke('sync_port_mappings', { identity, deviceId, document }) });
  }

  setOnline(online: boolean) {
    this.online = online;
    this.service.setConnected(online);
  }

  mount = () => {
    this.service.activate();
    this.service.setConnected(this.online);
    const stopPeerUpdates = this.peer?.subscribe(this.connectionChanged);
    const stopUpdates = this.service.subscribe(() => {
      savePortMappings(this.scope, this.service.snapshot());
      this.releaseIfIdle();
    });
    const stopSync = this.sync.start();
    const unregister = this.local ? registerLocalBrowserMappings(this.scope, this.service)
      : browserMappings.register(this.scope, this.service);
    return () => {
      unregister(); stopSync(); stopUpdates(); stopPeerUpdates?.();
      this.service.dispose(); this.releasePeer();
    };
  };

  private connectionChanged = () => {
    const ready = this.peer?.snapshot().ready ?? false;
    const lost = this.ready && !ready;
    this.ready = ready;
    // Negotiation retries transient failures. Only readiness, cancellation or the deadline settles a start.
    if (ready) for (const done of this.pending) done(true);
    if (lost) {
      this.service.setConnected(false);
      this.service.setConnected(this.online);
    }
  };

  private waitForConnection() {
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const done = (ready: boolean) => {
        clearTimeout(timer); this.pending.delete(done);
        if (ready) resolve(); else reject(new Error('Mapping connection unavailable'));
      };
      const timer = setTimeout(() => done(false), CONNECT_TIMEOUT_MS);
      this.pending.add(done);
      if (!this.demanded) { this.demanded = true; this.peer?.start(); }
    });
  }

  private releasePeer() {
    for (const done of this.pending) done(false);
    if (!this.demanded) return;
    this.demanded = false; this.ready = false; this.peer?.stop();
  }

  private releaseIfIdle() {
    if (!this.demanded) return;
    if (this.service.snapshot().some(row => ['running', 'starting', 'stopping'].includes(row.status))) return;
    for (const done of this.pending) done(false);
    if (!this.resourceCount) this.releasePeer();
  }
}
