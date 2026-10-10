import type { DesktopDisplay, DesktopInput, DesktopSettings, DesktopSystemPermission }
  from '../../../shared/remote-desktop/protocol';
import { RemoteDesktopHost } from '../../desktop/src/remoteDesktop/host';
import { createGuiToolsClient } from '../../../shared/remote-chat/guiTools';
import type { IceServer } from '../../../shared/remote-chat/protocol';
import { clipboardFixture, desktopClipboard } from './remote-desktop-clipboard-fixture';
import type { ClipboardContent, ClipboardMessage } from '../../../shared/remote-desktop/clipboard';
import { STANDBY_PONG } from '../../../shared/remote-desktop/standbyProtocol';

declare global { interface Window { desktopRelayFixture?: {
  iceServers: IceServer[]; upgrade?: boolean; failDirectAttempts?: number; loseCommitReply?: boolean; directFirst?: boolean;
  delayDirectPingMs?: number;
} } }

const canvas = document.createElement('canvas');
// Supply a real Opus source through the existing video fixture to exercise the production receiver.
if (new URLSearchParams(location.search).has('audio')) {
  const addTrack = RTCPeerConnection.prototype.addTrack;
  RTCPeerConnection.prototype.addTrack = function(track, ...streams) {
    if (track.kind === 'video' && streams[0]) {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination); oscillator.start();
      addTrack.call(this, destination.stream.getAudioTracks()[0], streams[0]);
      this.addEventListener('connectionstatechange', () => {
        if (this.connectionState === 'closed') { oscillator.stop(); void context.close(); }
      });
    }
    return addTrack.call(this, track, ...streams);
  };
}
let opened = 0;
const displays: DesktopDisplay[] = [
  { id: 'display-1', name: 'DISPLAY1', width: 1600, height: 900, primary: true },
  { id: 'display-2', name: 'DISPLAY2', width: 900, height: 1600, primary: false },
];
let selected = displays[0];
const multiDisplay = new URLSearchParams(location.search).has('displays');
export const desktopTest = { inputs: [] as DesktopInput[], settings: [] as DesktopSettings[],
  permissionRequired: (new URLSearchParams(location.search).has('permissions')
    ? 'screenRecording' : null) as DesktopSystemPermission | null,
  permissionChecks: 0, captureAttempts: 0,
  disconnect: () => host.release('fixture'),
  reconnect: () => host.register('fixture', window.desktopRelayFixture?.iceServers ?? []),
  clipboard: clipboardFixture,
  localClipboard: { content: { format: 'text', text: 'Local clipboard' } as ClipboardContent,
    calls: [] as string[], delay: 0 },
  selectedDisplays: [] as string[], inputDisplays: [] as string[],
  displays,
  peers: [] as RTCPeerConnection[],
  standbyReady: [] as RTCPeerConnection[],
  iceErrors: [] as string[],
  frames: 0, captures: 0, closed: 0, concurrent: 0, maxConcurrent: 0, errors: [] as string[] };

async function frame(width: number) {
  desktopTest.concurrent += 1;
  desktopTest.maxConcurrent = Math.max(desktopTest.maxConcurrent, desktopTest.concurrent);
  canvas.width = width; canvas.height = Math.round(width * selected.height / selected.width);
  const context = canvas.getContext('2d')!;
  context.scale(width / 1600, width / 1600);
  context.fillStyle = '#12344e'; context.fillRect(0, 0, 1600, 900);
  context.fillStyle = '#eff4fb'; context.fillRect(130, 95, 1300, 695);
  context.fillStyle = '#dae4f2'; context.fillRect(130, 95, 1300, 65);
  context.font = '30px sans-serif'; context.fillStyle = '#263c58'; context.fillText('Remote AI · Windows', 160, 138);
  context.font = '38px sans-serif'; context.fillText('远程桌面', 200, 245);
  context.font = '22px sans-serif'; context.fillText('原生视频连接测试', 200, 295);
  for (let row = 0; row < 4; row++) {
    context.fillStyle = row % 2 ? '#e5ecf7' : '#f7f9fd'; context.fillRect(200, 340 + row * 90, 1160, 70);
    context.fillStyle = '#314c70'; context.fillText(['项目', '文件', '终端', '设置'][row], 230, 385 + row * 90);
  }
  context.fillStyle = '#94bdea'; context.fillRect((desktopTest.frames * 4) % 1500, 845, 100, 12);
  context.fillStyle = '#24384d'; context.fillRect(0, 870, 1600, 30);
  desktopTest.frames += 1;
  try {
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/jpeg', 0.85));
    return await blob.arrayBuffer();
  } finally { desktopTest.concurrent -= 1; }
}

// Only native IPC is substituted. Host capture pacing, WebRTC/SRTP, receiver and controls are production code.
if (new URLSearchParams(location.search).has('native-clipboard')) {
  Object.defineProperty(window, 'isTauri', { value: true, configurable: true });
}
Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
  invoke: async (command: string, args: {
    width?: number; input?: DesktopInput; displayId?: string; message?: ClipboardMessage; content?: ClipboardContent;
  } = {}) => {
    if (command === 'remote_desktop_read_local_clipboard') {
      desktopTest.localClipboard.calls.push('read');
      return structuredClone(desktopTest.localClipboard.content);
    }
    if (command === 'remote_desktop_write_local_clipboard') {
      desktopTest.localClipboard.calls.push('write');
      await new Promise(resolve => setTimeout(resolve, desktopTest.localClipboard.delay));
      desktopTest.localClipboard.content = structuredClone(args.content!); return;
    }
    if (command === 'remote_desktop_clipboard') return desktopClipboard(args.message!);
    if (command === 'remote_desktop_permissions') return { enabled: true, control: true };
    if (command === 'remote_desktop_system_permissions') {
      desktopTest.permissionChecks += 1;
      return { screenRecording: desktopTest.permissionRequired !== 'screenRecording',
        accessibility: desktopTest.permissionRequired === null };
    }
    if (command === 'remote_desktop_open') {
      desktopTest.captureAttempts += 1;
      if (desktopTest.permissionRequired) {
        const permission = desktopTest.permissionRequired === 'screenRecording' ? '屏幕录制' : '辅助功能';
        throw new Error(`请在 Mac 的远程设置中开启${permission}权限，然后重新连接。`);
      }
      desktopTest.captures += 1;
      selected = desktopTest.displays.find(item => item.id === args.displayId) ?? desktopTest.displays[0];
      desktopTest.selectedDisplays.push(selected.id);
      const id = `capture-${++opened}`;
      const macos = new URLSearchParams(location.search).has('macos');
      return multiDisplay || macos ? { id, displays: desktopTest.displays, displayId: selected.id,
        ...(macos ? { platform: 'macos' } : {}) } : id;
    }
    if (command === 'remote_desktop_frame') return frame(args.width!);
    if (command === 'remote_desktop_input') {
      desktopTest.inputs.push(args.input!); desktopTest.inputDisplays.push(selected.id); return;
    }
    if (command === 'remote_desktop_close') { desktopTest.closed += 1; return; }
    throw new Error(`Unexpected native call: ${command}`);
  },
}, configurable: true });

function delayFirstDirectPing(channel: RTCDataChannel, delay: number) {
  let delayed = false;
  channel.send = new Proxy(channel.send, {
    apply(send, receiver: unknown, args: unknown[]) {
      if (!delayed && args[0] === '{"kind":"ping"}') {
        delayed = true;
        setTimeout(() => { if (channel.readyState === 'open') Reflect.apply(send, receiver, args); }, delay);
        return;
      }
      return Reflect.apply(send, receiver, args);
    },
  });
}

if (window.desktopRelayFixture) {
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = new Proxy(Peer, { construct(target, args: [RTCConfiguration?]) {
    const blocked = 2 + 2 * (window.desktopRelayFixture?.failDirectAttempts ?? 0);
    const relay = !window.desktopRelayFixture?.directFirst
      && (!window.desktopRelayFixture?.upgrade || desktopTest.peers.length < blocked);
    const peer = new target({ ...args[0], iceTransportPolicy: args[0]?.iceTransportPolicy ?? (relay ? 'relay' : 'all') });
    const delay = window.desktopRelayFixture?.delayDirectPingMs;
    if (delay && desktopTest.peers.length >= 2) {
      peer.addEventListener('datachannel', ({ channel }) => delayFirstDirectPing(channel, delay));
    }
    peer.addEventListener('icecandidateerror', event => desktopTest.iceErrors.push(`${event.errorCode}: ${event.errorText}`));
    peer.addEventListener('icecandidate', event => {
      if (event.candidate) desktopTest.iceErrors.push(`candidate: ${event.candidate.type} ${event.candidate.protocol}`);
    });
    peer.addEventListener('connectionstatechange', () => desktopTest.iceErrors.push(`state: ${peer.connectionState}`));
    peer.addEventListener('datachannel', ({ channel }) => channel.addEventListener('message', ({ data }) => {
      if (data === STANDBY_PONG && !desktopTest.standbyReady.includes(peer)) desktopTest.standbyReady.push(peer);
    }));
    desktopTest.peers.push(peer); return peer;
  } });
}
const host = new RemoteDesktopHost(); host.register('fixture', window.desktopRelayFixture?.iceServers ?? []);
export async function desktopRequest<T>(body: object): Promise<T> {
  const request = body as { action: string; settings?: DesktopSettings; directUpgrade?: { action: string } };
  // Windows WebKit has no WebRTC. Its layout tests hold signaling while Chromium tests real media separately.
  if (request.action === 'open' && new URLSearchParams(location.search).has('layout-only')) {
    return new Promise<T>(() => {});
  }
  if (request.settings) desktopTest.settings.push(request.settings);
  try {
    const result = await host.request(body, 'fixture');
    if (request.directUpgrade?.action === 'commit' && window.desktopRelayFixture?.loseCommitReply) {
      window.desktopRelayFixture.loseCommitReply = false; throw new Error('Fixture lost commit reply');
    }
    if (request.action === 'open' && new URLSearchParams(location.search).has('legacy')) {
      delete (result as { capabilities?: unknown }).capabilities;
    }
    return result as T;
  }
  catch (error) { desktopTest.errors.push(String(error)); throw error; }
}
export const client = createGuiToolsClient(desktopRequest);
Object.assign(window, { desktopTest });
window.addEventListener('beforeunload', () => host.release());
