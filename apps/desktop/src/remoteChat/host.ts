import { guiApi } from '../pages/codexGui/api';
import { CHAT_POLICY_MESSAGE, setChatPolicy } from '../../../../shared/remote-chat/policy';
import { keyPair } from '../../../../shared/remote-chat/cipher';
import { ChatLink } from '../../../../shared/remote-chat/link';
import { createDesktopPeer } from './peer';
import { createDesktopNativePath } from './nativePath';
import { parseMessage, type ConnectionMode, type IceServer, type Signal }
  from '../../../../shared/remote-chat/protocol';
import { ChatOperations } from './operations';
import { guiComposer } from '../pages/codexGui/composerBridge';
import { COMPOSER_EVENT } from '../../../../shared/remote-chat/composer';
import { SIDEBAR_EVENT } from '../../../../shared/remote-chat/sidebar';
import { guiSidebar } from '../pages/codexGui/sidebarBridge';
import { EventStream } from './eventStream';
import { remoteQueue } from './queue';
import { QUEUE_EVENT } from '../../../../shared/remote-chat/queue';
import { GUI_ACCOUNTS_EVENT } from '../../../../shared/remote-chat/guiAccounts';
import { subscribeGuiEvent } from '../pages/codexGui/webEvents';
import { acknowledgedMessages } from './acknowledgedMessages';
import { guiAccountBalances } from './guiAccountBalances';
import { NativeChatTransport, type HostTransportEvent } from './nativeTransport';
import { connectionDetails } from './connectionDetails';
import { RelayQuota } from '../../../../shared/remote-chat/relayUsage';
import { BulkSource } from './bulkSource';
import { BULK_OPERATION } from '../../../../shared/remote-chat/bulkControl';

export class ChatHost {
  private quota = new RelayQuota();
  private readonly transport: NativeChatTransport;
  private generation = 0;
  private readonly leases = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly links = new Map<string, ChatLink>();
  private readonly bulkSources = new Map<string, BulkSource>();
  private readonly connectedSessions = new Set<string>();
  private operations = new ChatOperations();
  private stream = new EventStream((event) => this.broadcast(event));
  private unsubscribe?: () => void;
  private unsubscribeAccounts?: () => void;
  private readonly unsubscribeComposer: () => void;
  private readonly unsubscribeSidebar: () => void;
  private readonly unsubscribeQueue: () => void;
  private readonly unsubscribeMessages: () => void;
  private readonly unsubscribeBalances: () => void;
  private closed = false;
  private diagnosticsEnabled = false;
  private bulkRelayAvailable = false;

  constructor(private readonly onConnectionChange: (connected: boolean) => void) {
    this.transport = new NativeChatTransport((event) => this.transportEvent(event));
    this.unsubscribeBalances = guiAccountBalances.subscribe(() => {
      this.broadcast({ method: GUI_ACCOUNTS_EVENT, params: {} });
    });
    this.unsubscribeMessages = acknowledgedMessages.subscribe((event) => {
      this.stream.receive(this.operations.prepareEvent(event));
    });
    this.unsubscribeQueue = remoteQueue.subscribe((snapshot) => {
      this.broadcast({ method: QUEUE_EVENT, params: snapshot });
    });
    this.unsubscribeComposer = guiComposer.subscribe((snapshot) => {
      this.broadcast({ method: COMPOSER_EVENT, params: snapshot });
    });
    this.unsubscribeSidebar = guiSidebar.subscribe((snapshot) => {
      this.broadcast({ method: SIDEBAR_EVENT, params: snapshot });
    });
    void subscribeGuiEvent('codex-gui-account-changed', () => {
      this.broadcast({ method: GUI_ACCOUNTS_EVENT, params: {} });
    }).then((unsubscribe) => {
      if (this.closed) unsubscribe();
      else this.unsubscribeAccounts = unsubscribe;
    }).catch(() => this.close());
    void guiApi.subscribe((event) => {
      guiSidebar.receive(event); this.stream.receive(this.operations.prepareEvent(event));
    }).then((unsubscribe) => {
      if (this.closed) unsubscribe();
      else this.unsubscribe = unsubscribe;
    }).catch(() => this.close());
  }

  private transportEvent(event: HostTransportEvent) {
    if (this.closed) return;
    this.generation = event.generation;
    if (event.type === 'reset') { this.resetSessions(); return; }
    if (event.type === 'disconnected') {
      this.diagnosticsEnabled = false;
      for (const link of this.links.values()) link.setRelayAvailable(false);
    }
    if (event.type === 'message') {
      void this.receive(event.data).catch(() => {
        if (!this.closed && this.generation === event.generation) this.transport.reconnect(true);
      });
    }
  }

  private resetSessions() {
    for (const source of this.bulkSources.values()) source.close();
    this.bulkSources.clear();
    connectionDetails.reset();
    this.quota = new RelayQuota();
    const links = [...this.links.values()];
    this.links.clear();
    this.connectedSessions.clear();
    for (const lease of this.leases.values()) clearTimeout(lease);
    this.leases.clear();
    for (const link of links) link.close();
    this.stream.close();
    this.stream = new EventStream((event) => this.broadcast(event));
    this.operations.release();
    this.operations = new ChatOperations();
    this.onConnectionChange(false);
  }

  private lease(sessionId: string, expiresAt: unknown) {
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) throw new Error('Invalid lease');
    this.links.get(sessionId)?.renew(expiresAt);
    clearTimeout(this.leases.get(sessionId));
    this.leases.set(sessionId, setTimeout(() => this.drop(sessionId), Math.max(0, expiresAt - Date.now())));
  }
  private broadcast(event: unknown) {
    for (const link of this.links.values()) void link.send({ kind: 'event', event }).catch(() => link.close());
  }

  private send(message: object) {
    this.transport.send(message);
  }

  private endSession(sessionId: string) {
    try { this.transport.forgetSession(sessionId); }
    catch { /* Local teardown must finish even if the closing socket cannot notify the coordinator. */ }
  }

  private async receive(data: string) {
    const message = parseMessage(data);
    if (message.type === CHAT_POLICY_MESSAGE) {
      this.bulkRelayAvailable = message.fileBulkV1 === true;
      this.diagnosticsEnabled = message.connectionDiagnostics === 1;
      setChatPolicy(message.policy); return;
    }
    if (message.type === 'desktop-ice' && Array.isArray(message.desktopIceServers)) {
      for (const id of this.links.keys()) {
        this.operations.desktop.register(id, message.desktopIceServers as IceServer[]);
      }
      return;
    }
    if (this.quota.receive(message)) {
      connectionDetails.quota(this.quota.usage, this.quota.blocked);
      for (const link of this.links.values()) link.setRelayQuotaBlocked(this.quota.blocked);
      return;
    }
    const sessionId = message.sessionId;
    if (typeof sessionId !== 'string') return;
    if (message.type === 'relay-traffic') { connectionDetails.traffic(sessionId, message); return; }
    if (message.type === 'peer-open') { this.open(sessionId, message); return; }
    const link = this.links.get(sessionId);
    if (!link) return;
    if (message.type === 'resumed') {
      this.lease(sessionId, message.expiresAt);
      if (Array.isArray(message.desktopIceServers)) {
        this.operations.desktop.register(sessionId, message.desktopIceServers as IceServer[], Number(message.expiresAt));
      }
      link.setRelayAvailable(true);
    }
    if (message.type === 'peer-offline') link.setRelayAvailable(false);
    if (message.type === 'signal') await link.acceptSignal(message.payload as Signal);
    if (message.type === 'relay' && typeof message.payload === 'string') link.receive(message.payload);
    if (message.type === 'relay-ready') link.enableRelay();
    if (message.type === 'peer-close') this.drop(sessionId);
  }

  private open(sessionId: string, message: Record<string, unknown>) {
    // The authenticated coordinator applies the configured limit before sending peer-open.
    if (this.links.has(sessionId)) return;
    this.operations.desktop.register(sessionId, (message.desktopIceServers ?? message.iceServers) as IceServer[],
      typeof message.expiresAt === 'number' ? message.expiresAt : undefined);
    const keys = keyPair((size) => crypto.getRandomValues(new Uint8Array(size)));
    const link = new ChatLink({
      binaryBulk: true,
      bulkRelay: { available: () => this.bulkRelayAvailable && this.transport.ready,
        send: bytes => this.transport.sendBulk(sessionId, bytes) },
      sessionId, desktop: true, secret: keys.secret, publicKey: String(message.publicKey),
      transportVersion: Number(message.transportVersion), reconnectRelay: () => this.transport.reconnect(),
      diagnosticsEnabled: () => this.diagnosticsEnabled,
      iceServers: message.iceServers as IceServer[],
      tcp: message.tcpPunch as import('../../../../shared/remote-chat/tcp/types').TcpPunchConfig | undefined,
      createPeer: createDesktopPeer,
      createNativePath: createDesktopNativePath,
      nativeTraversal: message.nativeTraversal as import('../../../../shared/remote-chat/nativePath').NativeTraversalConfig,
      signal: (frame) => this.send(frame), relayBuffered: () => this.transport.bufferedAmount,
      mode: (mode) => this.updateConnection(sessionId, mode),
      error: () => this.drop(sessionId),
      message: (request) => {
        if (request.kind !== 'request') return;
        // This namespace is added by Rust from its cloud identity, never from a mobile request.
        const terminalOwner = typeof message.terminalOwner === 'string' ? message.terminalOwner : sessionId;
        const bulk = request.method === 'request'
          && (request.body as { operation?: string })?.operation === BULK_OPERATION;
        const response = bulk ? this.bulkSources.get(sessionId)!.execute(request)
          : this.operations.execute(request, link.connectionMode, sessionId, terminalOwner);
        void response.then((response) => {
          // A history response may include buffered fragments. Deliver those first to avoid replaying them afterward.
          this.stream.flush();
          return link.send(response);
        }).catch(() => link.close());
      },
    });
    keys.secret.fill(0);
    this.links.set(sessionId, link);
    this.bulkSources.set(sessionId, new BulkSource(link, sessionId));
    if (message.transportVersion === 2 && typeof message.resumeToken === 'string') {
      this.lease(sessionId, message.expiresAt);
    }
    this.operations.desktop.diagnose(sessionId, link.reportDiagnostic);
    this.operations.desktop.nativeMedia(sessionId, id => link.openNativeMedia(id));
    connectionDetails.open(sessionId, message.clientInfo);
    if (this.quota.blocked) link.setRelayQuotaBlocked(true);
    this.send({ type: 'signal', sessionId, payload: { kind: 'key', key: keys.publicKey } });
  }

  private updateConnection(sessionId: string, mode: ConnectionMode) {
    if (this.closed || !this.links.has(sessionId)) return;
    connectionDetails.update(sessionId, { mode });
    if (mode === 'direct' || mode === 'relay') this.connectedSessions.add(sessionId);
    else this.connectedSessions.delete(sessionId);
    this.onConnectionChange(this.connectedSessions.size > 0);
    if (mode === 'offline') this.drop(sessionId);
  }

  private drop(sessionId: string) {
    this.bulkSources.get(sessionId)?.close(); this.bulkSources.delete(sessionId);
    this.operations.release(sessionId);
    connectionDetails.remove(sessionId);
    const link = this.links.get(sessionId);
    this.links.delete(sessionId);
    clearTimeout(this.leases.get(sessionId));
    this.leases.delete(sessionId);
    this.connectedSessions.delete(sessionId);
    this.onConnectionChange(this.connectedSessions.size > 0);
    link?.close();
    if (!this.closed) this.endSession(sessionId);
  }

  close() {
    if (this.closed) return;
    for (const sessionId of this.links.keys()) this.endSession(sessionId);
    this.closed = true;
    for (const source of this.bulkSources.values()) source.close();
    this.bulkSources.clear();
    connectionDetails.reset();
    for (const lease of this.leases.values()) clearTimeout(lease);
    this.leases.clear();
    this.connectedSessions.clear();
    this.onConnectionChange(false);
    this.unsubscribe?.();
    this.unsubscribeAccounts?.();
    this.unsubscribeComposer();
    this.unsubscribeSidebar();
    this.unsubscribeQueue();
    this.unsubscribeMessages();
    this.unsubscribeBalances();
    this.stream.close();
    this.operations.release();
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.transport.close();
  }
}
