import type { Channel } from '@tauri-apps/api/core';
import previewImage from '../src-tauri/icons/32x32.png?inline';
import { saveGuiFontSize } from '../../../shared/conversation/guiAppearance';
import { applyThemeMode } from '../src/utils/themeMode';
import { saveGlobalFontSize } from '../../../shared/appearance/fontSize';
import { demoGuiSettings } from './gui-settings-fixture';
import { conversationSyncFixture } from '../../../shared/testing/conversationSyncFixture';
import type { SyncRequest } from '../../../shared/conversation/sync/types';
import '../src/styles.css';

const endpoint = new URLSearchParams(location.search).get('socket')!;
const parameters = new URLSearchParams(location.search);
if (parameters.has('font')) saveGlobalFontSize(Number(parameters.get('font')));
if (parameters.has('dark')) applyThemeMode('dark');
const syncFixture = conversationSyncFixture(new URLSearchParams());
const localSettingsOperations: Record<string, string> = {
  codex_gui_auto_switch_settings: 'guiAutoSwitchRead', codex_gui_set_auto_switch_settings: 'guiAutoSwitchWrite',
  codex_gui_model_context_settings: 'guiModelContextRead', codex_gui_set_model_context: 'guiModelContextWrite',
  codex_gui_system_prompt_settings: 'guiSystemPromptsRead',
  codex_gui_set_system_prompt_settings: 'guiSystemPromptsWrite',
};
const sockets = new Map<string, WebSocket>();
const commands: string[] = [];
const devices = [
  { deviceId: 'computer-one', name: 'Office PC', platform: 'windows', online: true },
  { deviceId: 'computer-two', name: 'Home PC', platform: 'macos', online: true },
  { deviceId: 'offline', name: 'Offline PC', platform: 'linux', online: false },
];
let callbackId = 0;
const callbacks = new Map<number, (value: unknown) => void>();
const listeners = new Map<number, string>();
let beats = 0;
let holdDirectory = false;
let clipboardImages: { mimeType: string; data: string }[] = [];
let holdClipboard = false;
const pendingClipboard: (() => void)[] = [];
const pendingDirectories: (() => void)[] = [];
setInterval(() => { beats++; }, 20);

type Batch = { sequence: number; events: ({ type: 'message'; data: string } | { type: 'closed'; code: number })[] };
type NativeArgs = { request: { clientId: string; deviceId: string; publicKey: string; message: object };
  events: Channel<Batch> };

async function invoke(command: string, args: NativeArgs) {
  commands.push(command);
  if (localSettingsOperations[command]) return demoGuiSettings({ ...args,
    operation: localSettingsOperations[command] })?.value;
  if (command === 'codex_conversation_sync') {
    return syncFixture.destination.request(args.request as unknown as SyncRequest);
  }
  if (command.startsWith('plugin:event|')) {
    const event = args as unknown as { event: string; handler: number; eventId: number };
    if (command === 'plugin:event|unlisten') { listeners.delete(event.eventId); return; }
    listeners.set(event.handler, event.event);
    return event.handler;
  }
  if (command === 'codex_gui_dropped_files') {
    if (holdClipboard) await new Promise<void>(resolve => pendingClipboard.push(resolve));
    return { references: [], files: [
      { name: 'dropped.png', mimeType: 'image/png', data: previewImage.split(',')[1] },
      { name: 'notes.txt', mimeType: 'application/octet-stream', data: btoa('dropped notes') },
    ] };
  }
  if (command === 'get_dream_skin_status') return { installed: true, session: 'running', activeThemeId: 'fixture',
    activeThemeAppearance: 'light', activeThemeOverlayOpacity: 0.85 };
  if (command === 'get_dream_skin_theme_preview') return previewImage;
  if (command === 'codex_gui_remote_clipboard_images') {
    if (holdClipboard) await new Promise<void>(resolve => pendingClipboard.push(resolve));
    return clipboardImages;
  }
  if (command === 'codex_gui_devices') {
    if (holdDirectory) await new Promise<void>(resolve => pendingDirectories.push(resolve));
    return { currentDeviceId: 'this-computer', identity: { baseUrl: 'https://fixture.test', userId: 'owner' }, devices };
  }
  if (command === 'gui_remote_open') {
    const socket = new WebSocket(endpoint);
    sockets.set(args.request.clientId, socket);
    let sequence = 0;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', role: 'mobile',
      deviceId: args.request.deviceId, publicKey: args.request.publicKey }));
    socket.onmessage = event => args.events.onmessage({ sequence: ++sequence,
      events: [{ type: 'message', data: String(event.data) }] });
    socket.onclose = event => args.events.onmessage({ sequence: 0, events: [{ type: 'closed', code: event.code }] });
    return;
  }
  if (command === 'gui_remote_send') return sockets.get(args.request.clientId)!.send(JSON.stringify(args.request.message));
  if (command === 'gui_remote_close') { sockets.get(args.request.clientId)?.close(); sockets.delete(args.request.clientId); return; }
  if (command === 'gui_remote_ack') return;
  throw new Error(`Unexpected native command: ${command}`);
}

Object.assign(window, { __TAURI_INTERNALS__: { invoke,
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  transformCallback: (callback: (value: unknown) => void) => { callbacks.set(++callbackId, callback); return callbackId; },
  unregisterCallback: (id: number) => { callbacks.delete(id); } },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => { listeners.delete(id); } },
  remoteGuiFixture: { commands, beats: () => beats, setFontSize: saveGuiFontSize, setThemeMode: applyThemeMode,
    pauseDirectory: () => { holdDirectory = true; },
    copyImage: () => { clipboardImages = [{ mimeType: 'image/png', data: previewImage.split(',')[1] }]; },
    dropFiles: (position: { x: number; y: number }) => {
      for (const [id, event] of listeners) {
        if (event === 'tauri://drag-drop') callbacks.get(id)?.({ event, id,
          payload: { paths: ['C:\\private\\dropped.png', 'C:\\private\\notes.txt'], position } });
      }
    },
    pauseClipboard: () => { holdClipboard = true; },
    releaseClipboard: () => { holdClipboard = false; pendingClipboard.splice(0).forEach(resolve => resolve()); },
    releaseDirectory: () => { holdDirectory = false; pendingDirectories.splice(0).forEach(resolve => resolve()); } } });
await import('./remote-gui-harness');

declare global {
  interface Window { remoteGuiFixture: {
    commands: string[]; beats: () => number; pauseDirectory: () => void; releaseDirectory: () => void;
    setFontSize: (size: number) => boolean;
    setThemeMode: (mode: 'light' | 'dark') => void;
    copyImage: () => void; pauseClipboard: () => void; releaseClipboard: () => void;
    dropFiles: (position: { x: number; y: number }) => void;
  } }
}
