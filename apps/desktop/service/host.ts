import { webcrypto } from 'node:crypto';
import { ChatLink } from '../../../shared/remote-chat/link';
import { keyPair } from '../../../shared/remote-chat/cipher';
import { setChatPolicy } from '../../../shared/remote-chat/policy';
import { parseMessage, type IceServer, type Signal } from '../../../shared/remote-chat/protocol';
import { invoke } from './rpc';
import { ServiceOperations } from './operations';
import { createServiceNativePath } from './nativePath';

interface Configuration { baseUrl: string; credential: string; deviceId: string; name: string; version: string }
interface Session { link: ChatLink; resumeToken: string; lease: ReturnType<typeof setTimeout> }
const random = (size: number) => webcrypto.getRandomValues(new Uint8Array(size));
// Stdout belongs exclusively to the parent RPC. Diagnostic metadata may use stderr, never credentials or payloads.
console.debug = () => {};
const configuration = await invoke<Configuration>('service_configuration');
if (!configuration.baseUrl.startsWith('https://')) throw new Error('A secure coordinator is required');
const operations = new ServiceOperations();
const sessions = new Map<string, Session>();
let chat: WebSocket | undefined;
let diagnosticsEnabled = false;

function send(message: object) {
  if (chat?.readyState !== WebSocket.OPEN) throw new Error('电脑连接中断，请稍后重试。');
  chat.send(JSON.stringify(message));
}
function release(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id); clearTimeout(session.lease); session.link.close(); operations.release(id);
}
function lease(id: string, expires: unknown) {
  const session = sessions.get(id);
  if (!session || typeof expires !== 'number' || !Number.isFinite(expires)) return;
  clearTimeout(session.lease);
  session.link.renew(expires);
  session.lease = setTimeout(() => release(id), Math.max(0, expires - Date.now()));
}

async function open(id: string, message: Record<string, unknown>) {
  if (sessions.has(id)) return;
  const keys = keyPair(random);
  const identity = await invoke<{ key: string; signature: string }>('service_sign', { sessionId: id, publicKey: keys.publicKey });
  operations.desktop.register(id, (message.desktopIceServers ?? message.iceServers) as IceServer[], Number(message.expiresAt));
  const link = new ChatLink({ sessionId: id, desktop: true, secret: keys.secret, publicKey: String(message.publicKey),
    transportVersion: Number(message.transportVersion), iceServers: [], relayBuffered: () => chat?.bufferedAmount ?? 0,
    diagnosticsEnabled: () => diagnosticsEnabled,
    nativeTraversal: message.nativeTraversal as import('../../../shared/remote-chat/nativePath').NativeTraversalConfig,
    createNativePath: createServiceNativePath,
    createPeer: () => ({ offer: async () => {}, accept: async () => {}, close: () => {} }),
    signal: send, mode: mode => { if (mode === 'offline') release(id); }, error: () => release(id),
    message: request => {
      if (request.kind !== 'request') return;
      void operations.execute(request, id).then(response => link.send(response)).catch(() => release(id));
    },
  });
  sessions.set(id, { link, resumeToken: String(message.resumeToken), lease: setTimeout(() => release(id), 60_000) });
  operations.desktop.diagnose(id, link.reportDiagnostic);
  operations.desktop.nativeMedia(id, viewId => link.openNativeMedia(viewId));
  lease(id, message.expiresAt);
  send({ type: 'signal', sessionId: id, payload: { kind: 'key', key: keys.publicKey, identity } });
}

async function receive(data: string) {
  const message = parseMessage(data);
  if (message.type === 'chat-policy') {
    diagnosticsEnabled = message.connectionDiagnostics === 1;
    setChatPolicy(message.policy); return;
  }
  if (message.type === 'desktop-ice' && Array.isArray(message.desktopIceServers)) {
    for (const id of sessions.keys()) operations.desktop.register(id, message.desktopIceServers as IceServer[]);
    return;
  }
  const id = String(message.sessionId);
  if (message.type === 'peer-open') { await open(id, message); return; }
  const session = sessions.get(id); if (!session) return;
  if (message.type === 'resumed') {
    lease(id, message.expiresAt);
    if (message.renewed !== true) session.link.setRelayAvailable(true);
    if (Array.isArray(message.desktopIceServers)) operations.desktop.register(id, message.desktopIceServers as IceServer[],
      Number(message.expiresAt));
  }
  if (message.type === 'peer-offline') session.link.setRelayAvailable(false);
  if (message.type === 'signal') await session.link.acceptSignal(message.payload as Signal);
  if (message.type === 'relay-ready') session.link.enableRelay();
  if (message.type === 'relay' && typeof message.payload === 'string') session.link.receive(message.payload);
  if (message.type === 'peer-close') release(id);
}

function connect(path: 'device-chat' | 'device-switch', attempt = 0) {
  const url = new URL(configuration.baseUrl);
  url.protocol = 'wss:'; url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
  const socket = new WebSocket(url);
  if (path === 'device-chat') { chat = socket; diagnosticsEnabled = false; }
  let incoming = Promise.resolve();
  let refresh:ReturnType<typeof setTimeout> | undefined;
  socket.onopen = () => {
    refresh=setTimeout(()=>socket.close(1000),50*60_000);
    socket.send(JSON.stringify({ type: 'authenticate', role: 'desktop', accessToken: configuration.credential,
      deviceId: configuration.deviceId, name: configuration.name, platform: 'Windows', appVersion: configuration.version,
      transportVersion: 2, nativeTraversal: true,
      sessions: [...sessions].map(([sessionId, value]) => ({ sessionId, resumeToken: value.resumeToken })) }));
  };
  socket.onmessage = event => {
    if (typeof event.data !== 'string' || event.data.length > 1024 * 1024) { socket.close(); return; }
    attempt = 0;
    if (path === 'device-chat') incoming = incoming.then(() => receive(event.data as string)).catch(() => socket.close());
    else {
      const message = parseMessage(event.data);
      if (message.commandId) socket.send(JSON.stringify({ type: 'switch-result', commandId: message.commandId,
        success: false, error: '请先登录电脑，再进行此操作。' }));
    }
  };
  socket.onerror = () => socket.close();
  socket.onclose = event => {
    clearTimeout(refresh);
    if (path === 'device-chat') {
      for (const value of sessions.values()) value.link.setRelayAvailable(false);
      if (event.code === 4000 || event.code === 4001) for (const id of sessions.keys()) release(id);
    }
    const delay = event.code === 4008 ? 30_000 : Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    setTimeout(() => connect(path, attempt + 1), delay);
  };
}
connect('device-chat'); connect('device-switch');
