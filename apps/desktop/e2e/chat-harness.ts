import { keyPair } from '../../../shared/remote-chat/cipher';
import { ChatLink } from '../../../shared/remote-chat/link';
import { RtcPeer } from '../../../shared/remote-chat/rtcPeer';
import { ChatRpc } from '../../../shared/remote-chat/rpc';
import { parseMessage, type IceServer, type RpcMessage, type Signal } from '../../../shared/remote-chat/protocol';
import { demoResponse, demoState, changeDemoSidebar } from './demo-conversation';
import { setDemoReview } from './demo-task-review';
import { changeDemoComposer } from './demo-composer';
import { demoSkillsDelay, setDemoSkills } from './demo-skills';
import { downloadFixture, fileDownloadResponse } from './file-download-fixture';
import { setChatConnectionMode } from '../../../shared/remote-chat/policy';

const query = new URLSearchParams(location.search);
const desktopFixture = query.has('remote-desktop') ? import('../../web/e2e/remote-desktop-fixture') : undefined;
const desktopRequests = new Map<string, Promise<RpcMessage>>();
const desktop = query.get('role') === 'desktop';
const blocked = query.get('blocked') === 'true';
const keys = keyPair((size) => crypto.getRandomValues(new Uint8Array(size)));
let socket: WebSocket;
let link: ChatLink;
const links = new Map<string, ChatLink>();
// The real host broadcasts events to every phone; a reconnect must not redirect another phone's stream.
const broadcastLink: Pick<ChatLink, 'send'> = { send: async (message) => {
  await Promise.all([...links.values()].filter(activeLink => activeLink.connectionMode !== 'offline')
    .map(activeLink => activeLink.send(message)));
} };
const events: unknown[] = [];
const modes: string[] = [];
const errors: string[] = [];
let executions = 0;
let settingsDelay = 0;
let submissionDelay = 0;
let historyDelay = 0;
let tokenSummaryDelay = 0;
let legacyHistory = false;
let heartbeats = 0;
setInterval(() => { heartbeats += 1; }, 20);
const requests = new Map<string, RpcMessage>();
const rpc = new ChatRpc({ prefix: `browser:${keys.publicKey}`,
  send: (request) => link.send(request), event: (event) => events.push(event) });
function connectSocket() {
  socket = new WebSocket(query.get('socket')!);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', role: desktop ? 'desktop' : 'mobile',
  deviceId: query.get('device') || 'computer', publicKey: keys.publicKey,
  transportVersion: Number(query.get('transportVersion') ?? 1) }));
  socket.onmessage = receive;
  socket.onclose = () => {
    for (const activeLink of links.values()) activeLink.close();
    links.clear();
    // The PC stays running when a phone leaves; preserve demo history across coordinator reconnections.
    if (desktop && query.has('demo')) setTimeout(connectSocket, 200);
  };
}
connectSocket();

async function receive({ data }: MessageEvent<string>) {
  const frame = parseMessage(data);
  if (frame.type === 'registered') { document.querySelector('#status')!.textContent = 'registered'; return; }
  if (frame.type === 'paired' || frame.type === 'peer-open') {
    const sessionLink: ChatLink = new ChatLink({ sessionId: String(frame.sessionId), desktop, secret: keys.secret,
      transportVersion: Number(frame.transportVersion),
      publicKey: desktop ? String(frame.publicKey) : undefined, iceServers: frame.iceServers as IceServer[],
      createPeer: (options) => blocked ? { offer: async () => undefined, accept: async () => undefined, close() {} }
        : new RtcPeer(options, () => new RTCPeerConnection({ iceServers: options.iceServers })),
      signal: (signal) => socket.send(JSON.stringify(signal)), relayBuffered: () => socket.bufferedAmount,
      mode: (mode) => {
        setChatConnectionMode(mode); modes.push(mode); document.querySelector('#status')!.textContent = mode; rpc.retry();
      },
      error: (message) => errors.push(message), message: (message) => {
        if (!desktop) { rpc.receive(message); return; }
        if (message.kind !== 'request') return;
        if (desktopFixture && (message.body as { operation?: string })?.operation === 'remoteDesktop') {
          const target = sessionLink;
          let task = desktopRequests.get(message.id);
          if (!task) {
            task = desktopFixture.then(fixture => fixture.desktopRequest(message.body as object))
              .then(data => ({ kind: 'response' as const, id: message.id, data }))
              .catch(error => ({ kind: 'response' as const, id: message.id, error: String(error) }));
            desktopRequests.set(message.id, task);
          }
          void task.then(response => target.send(response)).catch(error => errors.push(String(error)));
          return;
        }
        let response = requests.get(message.id);
        if (!response) {
          executions += 1;
          try {
            response = legacyHistory && (message.body as { operation?: string })?.operation === 'syncHistory'
              ? { kind: 'response', id: message.id, error: '当前手机端暂不支持此操作。' }
              : { kind: 'response', id: message.id,
                data: query.has('download') ? fileDownloadResponse(message.body)
                  : query.has('demo') ? structuredClone(demoResponse(message, broadcastLink)) : message.body };
          } catch {
            // Match the desktop boundary: a failed operation must not tear down the encrypted connection.
            response = { kind: 'response', id: message.id, error: '暂时无法完成此操作，请重试。' };
          }
          if ((message.body as { operation?: string })?.operation !== 'fileRead') requests.set(message.id, response);
        }
        const target = sessionLink;
        const isSettings = (message.body as { operation?: string } | undefined)?.operation === 'composerSet';
        const isSubmission = ['queueEnqueue', 'send', 'steer'].includes(
          String((message.body as { operation?: string })?.operation));
        const isHistory = (message.body as { operation?: string } | undefined)?.operation === 'syncHistory';
        const isSkills = (message.body as { operation?: string } | undefined)?.operation === 'skills';
        const isTokenSummary = (message.body as { operation?: string } | undefined)?.operation === 'tokenSummary';
        const send = () => { void target.send(response).catch((error: unknown) => errors.push(String(error))); };
        if (isSubmission && submissionDelay) setTimeout(send, submissionDelay);
        else if (isSettings && settingsDelay) setTimeout(send, settingsDelay);
        else if (isHistory && historyDelay) setTimeout(send, historyDelay);
        else if (isSkills && demoSkillsDelay()) setTimeout(send, demoSkillsDelay());
        else if (isTokenSummary && tokenSummaryDelay) setTimeout(send, tokenSummaryDelay);
        else if (query.has('demo') && (message.body as { operation?: string })?.operation === 'fileRead') {
          setTimeout(send, 300);
        }
        else send();
      },
    });
    link = sessionLink;
    links.set(String(frame.sessionId), sessionLink);
    if (typeof frame.expiresAt === 'number') sessionLink.renew(frame.expiresAt);
    if (desktop) socket.send(JSON.stringify({ type: 'signal', sessionId: frame.sessionId,
      payload: { kind: 'key', key: keys.publicKey } }));
    else await link.offer();
    return;
  }
  // Reconnecting clients can overlap with an old socket that is still closing.
  const target = links.get(String(frame.sessionId));
  if (!target) return;
  if (frame.type === 'peer-offline') target.setRelayAvailable(false);
  if (frame.type === 'resumed') {
    target.renew(Number(frame.expiresAt));
    target.setRelayAvailable(true);
  }
  if (frame.type === 'signal') await target.acceptSignal(frame.payload as Signal);
  if (frame.type === 'relay-ready') target.enableRelay();
  if (frame.type === 'relay') target.receive(String(frame.payload));
  if (frame.type === 'peer-close') { links.delete(String(frame.sessionId)); target.close(); }
}

declare global {
  interface Window {
    chatTest: { modes: string[]; errors: string[]; events: unknown[]; request: (text: string) => Promise<unknown>;
      fallback: () => void; stream: (text: string) => Promise<void>; executions: () => number; beats: () => number;
      demoState: typeof demoState; setReview: typeof setDemoReview;
      setComposer: (input: unknown) => void; setSidebar: (action: string) => void;
      setSettingsDelay: (milliseconds: number) => void; setHistoryDelay: (milliseconds: number) => void;
      setSkills: typeof setDemoSkills;
      setTokenSummaryDelay: (milliseconds: number) => void;
      setSubmissionDelay: (milliseconds: number) => void;
      setLegacyHistory: (enabled: boolean) => void };
    downloadFixture: (path: string) => ReturnType<typeof downloadFixture>;
  }
}
window.chatTest = { modes, errors, events, request: (text) => rpc.request('request', { text }),
  fallback: () => link.fallback(), stream: (text) => broadcastLink.send({ kind: 'event', event: { text } }),
  executions: () => executions, beats: () => heartbeats, demoState, setReview: setDemoReview,
  setComposer: (input) => { changeDemoComposer(input, broadcastLink); },
  setSkills: setDemoSkills,
  setSubmissionDelay: (milliseconds) => { submissionDelay = Math.max(0, Math.min(20000, milliseconds)); },
  setTokenSummaryDelay: (milliseconds) => { tokenSummaryDelay = Math.max(0, Math.min(20000, milliseconds)); },
  setSettingsDelay: (milliseconds) => { settingsDelay = Math.max(0, Math.min(5000, milliseconds)); },
  setHistoryDelay: (milliseconds) => { historyDelay = Math.max(0, Math.min(5000, milliseconds)); },
  setLegacyHistory: (enabled) => { legacyHistory = enabled; },
  setSidebar: (action) => { changeDemoSidebar(action, broadcastLink); } };
window.downloadFixture = (path) => downloadFixture(rpc, path);
