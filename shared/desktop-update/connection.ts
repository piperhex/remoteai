import { DESKTOP_UPDATE_CAPABILITY, parseUpdateStatus, UPDATE_MESSAGES,
  type DesktopUpdateStatus, type UpdateAction, type UpdateDevice } from './protocol';
import { ReconnectBackoff } from '../realtime/reconnectBackoff';

const REQUEST_TIMEOUT_MS = 45_000;
export interface UpdateSession { baseUrl: string; accessToken: string }
export interface UpdateSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
}
export interface UpdateConnectionOptions {
  retryRandom?: () => number;
  authorize: () => Promise<UpdateSession>;
  createSocket?: (url: string) => UpdateSocket;
}
export interface UpdateSnapshot {
  devices: UpdateDevice[];
  selectedId: string;
  connected: boolean;
  status: DesktopUpdateStatus | null;
  busy: boolean;
  checked: boolean;
  updated: boolean;
  error: string;
}
interface Pending {
  id: string; device: string; action: UpdateAction;
  timer: ReturnType<typeof setTimeout>;
}

export class DesktopUpdateConnection {
  private readonly backoff: ReconnectBackoff;
  private state: UpdateSnapshot = { devices: [], selectedId: '', connected: false,
    status: null, busy: false, checked: false, updated: false, error: '' };
  private listeners = new Set<() => void>();
  private socket?: UpdateSocket;
  private pending?: Pending;
  private reconnect?: ReturnType<typeof setTimeout>;
  private authTimer?: ReturnType<typeof setTimeout>;
  private active = false;
  private generation = 0;
  private sequence = 0;
  private expected = new Map<string, string>();
  private receivedSnapshot = false;
  private earlyDeviceEvents: Record<string, unknown>[] = [];
  constructor(private readonly options: UpdateConnectionOptions) {
    this.backoff = new ReconnectBackoff({ initialMs: 3000, random: options.retryRandom });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private patch(value: Partial<UpdateSnapshot>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }

  start() { if (!this.active) { this.active = true; void this.connect(); } }
  stop() {
    this.active = false;
    this.generation += 1;
    clearTimeout(this.reconnect);
    clearTimeout(this.authTimer);
    this.clearPending();
    this.socket?.close();
    this.socket = undefined;
  }

  select = (selectedId: string) => {
    if (selectedId === this.state.selectedId) return;
    this.patch({ selectedId, status: null, checked: false, updated: false, error: '', busy: false });
    this.request('status');
  };

  request = (action: UpdateAction, version?: string) => {
    if (this.pending) return;
    const device = this.state.devices.find((item) => item.deviceId === this.state.selectedId);
    if (!this.state.connected || !device?.online || !device.capabilities?.includes(DESKTOP_UPDATE_CAPABILITY)) return;
    const id = String(++this.sequence);
    const timer = setTimeout(() => {
      this.clearPending();
      this.patch({ busy: false, error: UPDATE_MESSAGES.timeout });
      if (device.deviceId !== this.state.selectedId) this.request('status');
    }, REQUEST_TIMEOUT_MS);
    this.pending = { id, device: device.deviceId, action, timer };
    if (action === 'install' && version) this.expected.set(device.deviceId, version);
    this.patch({ busy: true, error: '', ...(action !== 'status' ? { updated: false } : {}) });
    try {
      this.socket?.send(JSON.stringify({ type: 'app-update', requestId: id,
        deviceId: device.deviceId, action, version }));
    } catch { this.disconnected(); }
  };

  private async connect() {
    if (!this.active) return;
    const generation = ++this.generation;
    this.receivedSnapshot = false;
    this.earlyDeviceEvents = [];
    try {
      const session = await this.options.authorize();
      if (!this.active || generation !== this.generation) return;
      const socket = (this.options.createSocket ?? createUpdateSocket)(socketUrl(session.baseUrl));
      this.socket = socket;
      this.authTimer = setTimeout(() => this.disconnected(), REQUEST_TIMEOUT_MS);
      socket.onopen = () => {
        if (generation !== this.generation) return;
        socket.send(JSON.stringify({ type: 'subscribe-devices', accessToken: session.accessToken }));
      };
      socket.onmessage = ({ data }) => {
        if (generation === this.generation) this.receive(data);
      };
      socket.onclose = socket.onerror = () => {
        if (generation === this.generation) this.disconnected();
      };
    } catch {
      if (generation === this.generation) this.disconnected();
    }
  }

  private disconnected() {
    this.generation += 1;
    clearTimeout(this.reconnect);
    clearTimeout(this.authTimer);
    this.clearPending();
    this.socket?.close();
    this.socket = undefined;
    this.patch({ connected: false, busy: false, error: UPDATE_MESSAGES.disconnected });
    if (this.active) this.reconnect = setTimeout(() => {
      this.reconnect = undefined; void this.connect();
    }, this.backoff.next());
  }

  private receive(raw: unknown) {
    if (typeof raw !== 'string') return;
    let message: Record<string, unknown>;
    try { message = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'app-update-result') { this.result(message); return; }
    let devices = deviceMessage(this.state.devices, message);
    if (!devices) return;
    if (message.type === 'devices-snapshot') {
      this.backoff.reset();
      devices = this.earlyDeviceEvents.reduce((current, event) => deviceMessage(current, event) ?? current, devices);
      this.earlyDeviceEvents = [];
      this.receivedSnapshot = true;
    } else if (!this.receivedSnapshot) this.earlyDeviceEvents.push(message);
    const connected = this.state.connected || message.type === 'devices-snapshot';
    if (connected) clearTimeout(this.authTimer);
    const selectedId = devices.some((device) => device.deviceId === this.state.selectedId)
      ? this.state.selectedId : (devices.find((device) => device.online) ?? devices[0])?.deviceId ?? '';
    const changed = selectedId !== this.state.selectedId;
    this.patch({ devices, connected, selectedId, error: '',
      ...(changed ? { status: null, checked: false, updated: false } : {}) });
    if (message.type !== 'device-offline') this.request('status');
  }

  private result(message: Record<string, unknown>) {
    const pending = this.pending;
    if (!pending || message.requestId !== pending.id) return;
    this.clearPending();
    if (pending.device !== this.state.selectedId) {
      this.patch({ busy: false }); this.request('status'); return;
    }
    const status = parseUpdateStatus(message.data);
    if (message.error || !status) {
      this.patch({ busy: false, error: typeof message.error === 'string' ? message.error : UPDATE_MESSAGES.failed });
      return;
    }
    const updated = this.expected.get(pending.device) === status.currentVersion;
    if (updated) this.expected.delete(pending.device);
    this.patch({ status, busy: false, error: '', updated: this.state.updated || updated,
      checked: this.state.checked || pending.action === 'check' });
  }

  private clearPending() { clearTimeout(this.pending?.timer); this.pending = undefined; }
}

function createUpdateSocket(url: string): UpdateSocket {
  const socket = new WebSocket(url);
  const bridge: UpdateSocket = { onopen: null, onmessage: null, onclose: null, onerror: null,
    send: (data) => socket.send(data), close: () => socket.close() };
  socket.onopen = () => bridge.onopen?.();
  socket.onmessage = (event) => bridge.onmessage?.({ data: event.data });
  socket.onclose = () => bridge.onclose?.();
  socket.onerror = () => bridge.onerror?.();
  return bridge;
}

function socketUrl(base: string) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid server');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/device-switch`;
  url.search = ''; url.hash = '';
  return url.toString();
}

function parseDevice(value: unknown): UpdateDevice | null {
  if (!value || typeof value !== 'object') return null;
  const device = value as Partial<UpdateDevice>;
  if (typeof device.deviceId !== 'string' || typeof device.name !== 'string'
    || typeof device.platform !== 'string' || typeof device.online !== 'boolean') return null;
  return { deviceId: device.deviceId, name: device.name, platform: device.platform, online: device.online,
    appVersion: typeof device.appVersion === 'string' ? device.appVersion : null,
    capabilities: Array.isArray(device.capabilities)
      ? device.capabilities.filter((value) => typeof value === 'string') : [] };
}

function deviceMessage(current: UpdateDevice[], message: Record<string, unknown>): UpdateDevice[] | null {
  if (message.type === 'devices-snapshot' && Array.isArray(message.devices)) {
    return message.devices.map(parseDevice).filter((device): device is UpdateDevice => device !== null);
  }
  if (message.type === 'device-online') {
    const device = parseDevice(message.device);
    return device ? [device, ...current.filter((item) => item.deviceId !== device.deviceId)] : null;
  }
  if (message.type === 'device-removed') return current.filter((item) => item.deviceId !== message.deviceId);
  if (message.type === 'device-offline') return current.map((item) => item.deviceId === message.deviceId
    ? { ...item, online: false } : item);
  return null;
}
