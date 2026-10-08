import { CHAT_POLICY_MESSAGE, setChatConnectionMode, setChatPolicy } from '../policy';
import { keyPair } from '../cipher';
import type { PacketCipherFactory } from '../packetCipher';
import { ChatLink } from '../link';
import { ChatRpc } from '../rpc';
import { HostIdentityError, type HostKeyVerifier } from '../trustedHost';
import { browserChatSocket, type ChatSocket } from './socket';
import { browserClientInfo, type ChatClientInfo } from './clientInfo';
import { RelayQuota, RELAY_QUOTA_MESSAGE } from '../relayUsage';
import { hasUpload, uploadProgress, type UploadProgress } from '../uploadProgress';
import { authorizationError, CONNECTION_ERRORS, socketConnectionError } from '../connectionErrors';
import { SessionRenewal } from './sessionRenewal';
import { PublicEndpointObserver } from '../publicEndpointObserver';
import { downloadBulkClient } from './bulkClient';
import { BULK_ERROR_EVENT } from '../bulkControl';
import { BulkError, type BulkErrorCode } from '../bulkLimits';
import {
  chatSocketUrl, parseMessage, type ConnectionMode, type IceServer, type RpcRequest, type Signal,
} from '../protocol';

export interface ConnectionEvents {
  directEndpoints?: (value?: import('../connectionEndpoints').ConnectionEndpoints) => void;
  publicEndpoints?: (value: import('../publicEndpoints').ConnectionPublicEndpoints) => void;
  stage?: (stage: import('../connectionHealth').ConnectionStage) => void;
  delivery?: (value: import('../taskDelivery').TaskDelivery) => void;
  upload?: (progress: UploadProgress) => void;
  mode: (mode: ConnectionMode) => void;
  ready: () => void;
  event: (event: unknown) => void;
  error: (message: string) => void;
  retryAt?: (timestamp: number | null) => void;
}

interface ConnectionOptions extends ConnectionEvents {
  binaryBulk?: boolean;
  bulkFailure?: (transferId: string, epoch: string, code: string) => void;
  verifyHostKey?: HostKeyVerifier;
  /** Multi-device clients publish only the visible connection's transfer mode. */
  managePolicyMode?: boolean;
  tcpPunch?: boolean;
  createNativePath?: import('../nativePath').NativePathFactory;
  clientInfo?: ChatClientInfo;
  createSocket?: (url: string) => ChatSocket;
  deviceId: string;
  authorize: () => Promise<{ baseUrl: string; accessToken: string }>;
  renewAuthorization?: () => Promise<void>;
  randomBytes: (length: number) => Uint8Array;
  createPacketCipher?: PacketCipherFactory;
  createPeer: (options: import('../protocol').PeerOptions) => import('../protocol').Peer;
}

const CONNECTION_TIMEOUT_MS = 30_000;
const SOCKET_CLOSE_GRACE_MS = 250;
const SESSION_UNAVAILABLE_CODE = 4004;
const MAX_RESUME_UNAVAILABLE_REPLIES = 2;

export class ChatConnection {
  private bulkSupported = false;
  setBulkSupport(value: unknown) {
    this.bulkSupported = !!value && typeof value === 'object'
      && 'fileBulkV1' in value && value.fileBulkV1 === true;
  }
  readonly downloadsBulk = downloadBulkClient({ peer: () => this.options.deviceId,
    link: () => this.link, supported: () => this.bulkSupported,
    request: body => this.request('request', body) });
  private readonly publicEndpoints = new PublicEndpointObserver(value => this.options.publicEndpoints?.(value));
  private readonly quota = new RelayQuota();
  private socket?: ChatSocket;
  private link?: ChatLink;
  private rpc?: ChatRpc;
  private timer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private socketErrorTimer?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private resumeUnavailableReplies = 0;
  private generation = 0;
  private active = false;
  private resume?: { sessionId: string; resumeToken: string };
  private sessionReady = false;
  private socketAuthenticated = false;
  private diagnosticsEnabled = false;
  private authRenewal = false;
  private authRenewalTimer?: ReturnType<typeof setTimeout>;
  private leaseTimer?: ReturnType<typeof setTimeout>;
  private readonly renewal = new SessionRenewal(() => this.renewAuthorization());

  constructor(private readonly options: ConnectionOptions) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.publishPolicyMode('connecting');
    void this.connect();
  }

  /** Foreground recovery skips socket backoff without replacing the encrypted session or pending requests. */
  retryNow() {
    if (!this.active || !this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.connect();
  }

  private async connect() {
    this.options.stage?.('login');
    this.options.retryAt?.(null);
    const generation = ++this.generation;
    this.socketAuthenticated = false;
    this.diagnosticsEnabled = false;
    this.authRenewal = false;
    if (!this.link) this.options.mode('connecting');
    this.connectTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.fail(CONNECTION_ERRORS.timeout, true);
    }, CONNECTION_TIMEOUT_MS);
    try {
      const session = await this.options.authorize();
      if (!this.active || generation !== this.generation) return;
      this.options.stage?.('computer');
      const keys = keyPair(this.options.randomBytes);
      const url = chatSocketUrl(session.baseUrl);
      const socket = (this.options.createSocket ?? browserChatSocket)(url);
      this.socket = socket;
      this.bindSocket({ socket, keys, generation, accessToken: session.accessToken });
    } catch (error) {
      if (generation !== this.generation) return;
      const status = (error as { status?: number } | null)?.status;
      this.fail(authorizationError(error), status !== 401 && status !== 403);
    }
  }

  private bindSocket({ socket, keys, generation, accessToken }: {
    socket: ChatSocket; keys: ReturnType<typeof keyPair>; generation: number; accessToken: string;
  }) {
    socket.onopen = () => {
      if (generation !== this.generation) { socket.close(); return; }
      socket.send(JSON.stringify({ type: 'authenticate', role: 'mobile',
        accessToken, deviceId: this.options.deviceId, publicKey: keys.publicKey,
        transportVersion: 2, binaryRelay: true, fileBulkV1: true,
        tcpPunch: this.options.tcpPunch === true, resume: this.resume,
        nativeTraversal: Boolean(this.options.createNativePath),
        clientInfo: this.options.clientInfo ?? browserClientInfo() }));
    };
    let incoming = Promise.resolve();
    socket.onbulk = (sessionId, bytes) => {
      if (generation === this.generation && sessionId === this.resume?.sessionId) this.link?.bulk?.receive(bytes, 'relay');
    };
    socket.onmessage = ({ data }: { data: unknown }) => {
      if (generation !== this.generation || typeof data !== 'string') return;
      incoming = incoming.then(() => {
        if (generation === this.generation) return this.receive(data, keys);
      }).catch((error: unknown) => {
        if (generation !== this.generation) return;
        if (error instanceof HostIdentityError) { this.active = false; this.fail(error.message); }
        else this.fail(CONNECTION_ERRORS.invalid);
      });
    };
    socket.onclose = (event) => {
      keys.secret.fill(0);
      if (generation === this.generation) {
        this.fail(socketConnectionError(event.code), this.canRecoverSocketClose(event.code));
      }
    };
    socket.onerror = () => {
      if (generation !== this.generation || this.socketErrorTimer) return;
      // Give close a chance to report the server's reason; some native sockets never emit it.
      this.socketErrorTimer = setTimeout(() => {
        if (generation === this.generation) this.fail(CONNECTION_ERRORS.network, true);
      }, SOCKET_CLOSE_GRACE_MS);
    };
  }

  private canRecoverSocketClose(code: number) {
    if (!this.resume || code !== SESSION_UNAVAILABLE_CODE) return ![4000, 4001].includes(code);
    this.resumeUnavailableReplies += 1;
    // Give the PC one retry to restore its session; a lost session needs a fresh pairing.
    if (this.resumeUnavailableReplies < MAX_RESUME_UNAVAILABLE_REPLIES) return true;
    this.attempt = 0;
    return false;
  }

  private fail(message: string, recover = false) {
    if (recover && this.link?.resumable && this.resume) {
      this.link.setRelayAvailable(false);
      this.retrySocket();
      return;
    }
    this.options.error(message);
    this.disconnected();
  }

  private retrySocket() {
    clearTimeout(this.authRenewalTimer);
    this.generation += 1;
    clearTimeout(this.connectTimer);
    clearTimeout(this.socketErrorTimer);
    this.socketErrorTimer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.schedule();
  }

  private lease(expiresAt: unknown) {
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) throw new Error('Invalid lease');
    this.link?.renew(expiresAt);
    clearTimeout(this.leaseTimer);
    this.leaseTimer = setTimeout(() => this.fail(CONNECTION_ERRORS.expired), Math.max(0, expiresAt - Date.now()));
    if (this.options.renewAuthorization) this.renewal.update(expiresAt);
  }

  private async renewAuthorization() {
    if (!this.link?.resumable || !this.sessionReady) throw new Error('Session is not ready for renewal');
    const session = this.resume;
    try { await this.options.renewAuthorization?.(); }
    catch (error) {
      if (session !== this.resume || !this.active) return;
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403) { this.fail(authorizationError(error)); return; }
      throw error;
    }
    if (session !== this.resume || !this.active || !this.resume) return;
    if (this.authRenewal && this.socketAuthenticated && this.socket?.readyState === WebSocket.OPEN) {
      const socket = this.socket;
      const credentials = await this.options.authorize();
      if (session !== this.resume || !this.active) return;
      if (socket !== this.socket) throw new Error('Connection changed during renewal');
      socket.send(JSON.stringify({ type: 'renew-auth', accessToken: credentials.accessToken }));
      clearTimeout(this.authRenewalTimer);
      this.authRenewalTimer = setTimeout(() => this.fail(CONNECTION_ERRORS.network, true), CONNECTION_TIMEOUT_MS);
      return;
    }
    // Keep the data channel, cipher and pending RPCs while authenticating a replacement coordinator socket.
    this.link?.setRelayAvailable(false);
    this.retrySocket();
  }

  private async receive(data: string, keys: ReturnType<typeof keyPair>) {
    const message = parseMessage(data);
    if (message.type === CHAT_POLICY_MESSAGE) {
      this.diagnosticsEnabled = message.connectionDiagnostics === 1;
      this.authRenewal = message.authRenewal === true;
      setChatPolicy(message.policy); return;
    }
    if (message.type === 'auth-renewed') { clearTimeout(this.authRenewalTimer); return; }
    if (this.quota.receive(message)) {
      this.link?.setRelayQuotaBlocked(this.quota.blocked);
      if (this.quota.blocked && message.type === 'relay-quota') this.options.error(
        this.quota.reason === 'quota' ? RELAY_QUOTA_MESSAGE : '服务器转发暂不可用，请稍后重试或使用 P2P 直连。');
      return;
    }
    if (message.type === 'paired' && typeof message.sessionId === 'string') {
      this.options.stage?.('path');
      this.socketAuthenticated = true;
      if (message.transportVersion === 2 && typeof message.resumeToken === 'string') {
        this.resume = { sessionId: message.sessionId, resumeToken: message.resumeToken };
      }
      this.paired({ id: message.sessionId, iceServers: message.iceServers as IceServer[], keys,
        tcp: message.tcpPunch as import('../tcp/types').TcpPunchConfig | undefined,
        nativeTraversal: message.nativeTraversal as import('../nativePath').NativeTraversalConfig | undefined,
        transportVersion: Number(message.transportVersion) });
      if (this.resume) this.lease(message.expiresAt);
      return;
    }
    if (this.resume && message.sessionId !== this.resume.sessionId) return;
    if (message.type === 'resumed' && this.resume) {
      this.socketAuthenticated = true;
      this.resumeUnavailableReplies = 0;
      this.lease(message.expiresAt);
      clearTimeout(this.connectTimer);
      this.attempt = 0;
      if (message.renewed !== true) this.link?.setRelayAvailable(true);
      return;
    }
    if (message.type === 'peer-offline') this.link?.setRelayAvailable(false);
    if (message.type === 'signal') {
      const signal = message.payload as Signal;
      const link = this.link;
      if (signal.kind === 'key') await this.options.verifyHostKey?.(String(message.sessionId), signal);
      if (link === this.link) await link?.acceptSignal(signal);
    }
    if (message.type === 'relay-ready') this.link?.enableRelay();
    if (message.type === 'relay' && typeof message.payload === 'string') this.link?.receive(message.payload);
    if (message.type === 'peer-close') this.fail(CONNECTION_ERRORS.interrupted);
  }

  private paired(input: {
    tcp?: import('../tcp/types').TcpPunchConfig;
    nativeTraversal?: import('../nativePath').NativeTraversalConfig;
    id: string; iceServers: IceServer[]; keys: ReturnType<typeof keyPair>; transportVersion: number;
  }) {
    if (this.link) throw new Error('Already paired');
    this.rpc = new ChatRpc({ prefix: input.keys.publicKey.slice(0, 24),
      delivery: this.options.delivery,
      send: (message, progress) => this.link!.send(message, progress), event: this.options.event });
    this.link = new ChatLink({
      binaryBulk: this.options.binaryBulk ?? typeof document !== 'undefined',
      bulkRelay: { available: () => this.socket?.bulkAvailable === true,
        send: async () => { throw new BulkError('INVALID_RECORD'); } },
      sessionId: input.id, desktop: false, secret: input.keys.secret, iceServers: input.iceServers, tcp: input.tcp,
      transportVersion: input.transportVersion, reconnectRelay: () => this.fail(CONNECTION_ERRORS.network, true),
      diagnosticsEnabled: () => this.diagnosticsEnabled,
      directEndpoints: this.options.directEndpoints,
      createPeer: this.publicEndpoints.wrap(this.options.createPeer),
      nativeTraversal: input.nativeTraversal, createNativePath: this.options.createNativePath,
      createPacketCipher: this.options.createPacketCipher,
      signal: (frame) => {
        if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Disconnected');
        this.socket.send(JSON.stringify(frame));
      },
      relayBuffered: () => this.socket?.bufferedAmount ?? 0,
      message: (message) => {
        if (message.kind === 'event') {
          const event = message.event as { method?: string; params?: Record<string, string> };
          if (event?.method === BULK_ERROR_EVENT && event.params) {
            this.options.bulkFailure?.(event.params.transferId, event.params.epoch, event.params.code);
            this.link?.bulk?.failTransfer(event.params.transferId, event.params.epoch,
              new BulkError(event.params.code as BulkErrorCode));
            return;
          }
        }
        this.rpc?.receive(message);
      }, error: this.options.error,
      mode: (mode) => {
        if (!this.active) return;
        this.publishPolicyMode(mode);
        this.options.mode(mode);
        if (mode === 'offline') { if (this.link) this.disconnected(); return; }
        if (mode !== 'direct' && mode !== 'relay') return;
        if (this.socketAuthenticated) {
          clearTimeout(this.connectTimer);
          this.attempt = 0;
        }
        if (input.transportVersion !== 2) this.rpc?.retry();
        if (input.transportVersion !== 2 || !this.sessionReady) this.options.ready();
        this.sessionReady = true;
      },
    });
    if (this.quota.blocked) this.link.setRelayQuotaBlocked(true);
    void this.link.offer();
  }

  request<T>(method: RpcRequest['method'], body?: unknown): Promise<T> {
    if (!this.rpc) return Promise.reject(new Error('请先连接电脑。'));
    let lastProgress = '';
    let highestFraction = 0;
    return this.rpc.request<T>(method, body, method === 'request' && hasUpload(body) ? (fraction, items) => {
      if (fraction < highestFraction) return;
      highestFraction = fraction;
      const progress = uploadProgress(fraction);
      if (items) progress.items = items;
      const key = JSON.stringify(progress);
      if (key === lastProgress) return;
      lastProgress = key;
      this.options.upload?.(progress);
    } : undefined);
  }

  private disconnected() {
    clearTimeout(this.authRenewalTimer);
    this.generation += 1;
    clearTimeout(this.timer);
    this.timer = undefined;
    clearTimeout(this.connectTimer);
    clearTimeout(this.socketErrorTimer);
    this.socketErrorTimer = undefined;
    const socket = this.socket;
    if (this.resume && socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: 'peer-close', sessionId: this.resume.sessionId })); }
      catch { /* Logout still clears local keys and timers when the coordinator cannot be reached. */ }
    }
    this.socket = undefined;
    socket?.close();
    clearTimeout(this.leaseTimer);
    this.renewal.clear();
    this.resume = undefined;
    this.resumeUnavailableReplies = 0;
    this.sessionReady = false;
    const link = this.link;
    this.link = undefined;
    link?.close();
    this.publicEndpoints.reset();
    this.rpc?.close();
    this.rpc = undefined;
    this.options.mode('offline');
    this.publishPolicyMode('offline');
    this.schedule();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.options.retryAt?.(null);
    if (!this.active) return;
    const delay = Math.min(30_000, 1500 * 2 ** Math.min(this.attempt++, 5));
    this.options.retryAt?.(Date.now() + delay);
    this.timer = setTimeout(() => { this.timer = undefined; void this.connect(); }, delay);
  }

  stop() {
    this.active = false;
    this.disconnected();
  }

  reportDiagnostic: import('../diagnostics').ConnectionDiagnostic = (event, fields) => {
    this.link?.reportDiagnostic(event, fields);
  };
  openNativeMedia = (viewId: string) => this.link?.openNativeMedia(viewId) ?? Promise.resolve(undefined);

  async confirmHostIdentity(fingerprint: string) {
    if (!this.options.verifyHostKey?.confirm) throw new Error('当前连接无法更新电脑身份。');
    await this.options.verifyHostKey.confirm(fingerprint);
  }

  private publishPolicyMode(mode: ConnectionMode) {
    if (this.options.managePolicyMode !== false) setChatConnectionMode(mode);
  }
}
