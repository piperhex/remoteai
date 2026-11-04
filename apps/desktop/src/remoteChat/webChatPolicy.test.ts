import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChat } from '../../../web/src/chat/useChat';
import type { LinkOptions } from '../../../../shared/remote-chat/linkOptions';
import { checkFileUploadSize, DEFAULT_CHAT_POLICY, MIB, setChatConnectionMode, setChatPolicy }
  from '../../../../shared/remote-chat/policy';

interface Effect { dependencies: unknown[]; cleanup?: () => void }
interface Root { effects: Effect[]; controller?: unknown }
const runtime = vi.hoisted(() => ({
  root: undefined as Root | undefined, roots: [] as Root[], cursor: 0,
  pending: [] as Array<() => void>, links: new Map<string, LinkOptions>(),
  session: { baseUrl: 'https://example.test', email: 'test@example.test',
    accessToken: 'access', refreshToken: 'refresh' },
}));
vi.mock('react', () => ({
  useMemo: <T>(create: () => T) => { runtime.root!.controller ??= create(); return runtime.root!.controller as T; },
  useState: () => [true, () => undefined],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
    const root = runtime.root!;
    const index = runtime.cursor++;
    const previous = root.effects[index];
    if (previous && dependencies.every((value, offset) => Object.is(value, previous.dependencies[offset]))) return;
    runtime.pending.push(() => {
      previous?.cleanup?.(); root.effects[index] = { dependencies, cleanup: effect() || undefined };
    });
  },
}));
vi.mock('../../../web/src/api', () => ({
  apiJson: async () => ({}), getActiveSession: () => runtime.session, refreshSession: async () => undefined,
}));
vi.mock('../../../web/src/downloads/previews', () => ({ createPreviewDownloads: () => undefined }));
vi.mock('../../../../shared/downloads/manager', () => ({ downloadOwner: () => 'account' }));
vi.mock('../../../../shared/remote-chat/link', () => ({ ChatLink: class {
  resumable = true;
  constructor(options: LinkOptions) { runtime.links.set(options.sessionId, options); }
  offer = async () => undefined;
  send = async () => undefined;
  renew = () => undefined;
  close = () => undefined;
  setRelayAvailable = () => undefined;
} }));

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn();
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, setInterval, clearInterval });
  vi.stubGlobal('WebSocket', Socket);
  setChatConnectionMode('offline');
  setChatPolicy({ ...DEFAULT_CHAT_POLICY, fileUploadMaxMb: 1 });
});
afterEach(() => {
  for (const root of runtime.roots.splice(0)) for (const effect of root.effects) effect.cleanup?.();
  runtime.pending = []; runtime.links.clear(); runtime.root = undefined; Socket.instances = [];
  setChatPolicy(DEFAULT_CHAT_POLICY); setChatConnectionMode('offline');
  vi.useRealTimers(); vi.unstubAllGlobals();
});

async function mount(deviceId: string, mode: 'direct' | 'relay') {
  const root: Root = { effects: [] };
  runtime.roots.push(root);
  const render = (active: boolean) => {
    runtime.root = root; runtime.cursor = 0;
    const chat = useChat(runtime.session, deviceId, active);
    runtime.pending.splice(0).forEach(effect => effect());
    return chat;
  };
  const { controller } = render(true);
  await vi.advanceTimersByTimeAsync(0);
  const socket = Socket.instances.at(-1)!;
  socket.onopen?.();
  socket.receive({ type: 'paired', sessionId: deviceId, resumeToken: 'ab'.repeat(32),
    transportVersion: 2, iceServers: [], expiresAt: Date.now() + 120_000 });
  await vi.advanceTimersByTimeAsync(0);
  runtime.links.get(deviceId)!.mode(mode);
  render(true);
  return { render, socket, controller, link: runtime.links.get(deviceId)! };
}

it('restores direct A after switching to relay B without reconnecting either retained browser session', async () => {
  const direct = await mount('A', 'direct');
  expect(() => checkFileUploadSize(2 * MIB)).not.toThrow();
  direct.render(false);
  const relay = await mount('B', 'relay');
  expect(() => checkFileUploadSize(2 * MIB)).toThrow('1 MB');
  relay.render(false); direct.render(true);
  expect(() => checkFileUploadSize(2 * MIB)).not.toThrow();
  expect(Socket.instances).toHaveLength(2);
  expect(direct.socket.close).not.toHaveBeenCalled();
  expect(relay.socket.close).not.toHaveBeenCalled();
});

it('keeps the selected relay limit while a hidden direct browser connection reconnects or stops', async () => {
  const direct = await mount('A', 'direct');
  direct.render(false);
  const relay = await mount('B', 'relay');
  direct.socket.onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1500);
  const resumed = Socket.instances.at(-1)!;
  resumed.receive({ type: 'resumed', sessionId: 'A', expiresAt: Date.now() + 120_000 });
  await vi.advanceTimersByTimeAsync(0);
  direct.link.mode('direct'); direct.render(false);
  expect(() => checkFileUploadSize(2 * MIB)).toThrow('1 MB');
  direct.controller.stop(); direct.render(false);
  expect(() => checkFileUploadSize(2 * MIB)).toThrow('1 MB');
  expect(relay.socket.close).not.toHaveBeenCalled();
});

it('keeps the selected direct allowance while a hidden relay connection changes mode and reconnects', async () => {
  const direct = await mount('A', 'direct');
  direct.render(false);
  const relay = await mount('B', 'relay');
  relay.render(false); direct.render(true);
  relay.socket.onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1500);
  const resumed = Socket.instances.at(-1)!;
  resumed.receive({ type: 'resumed', sessionId: 'B', expiresAt: Date.now() + 120_000 });
  await vi.advanceTimersByTimeAsync(0);
  relay.link.mode('relay'); relay.render(false);
  expect(() => checkFileUploadSize(2 * MIB)).not.toThrow();
  relay.controller.stop(); relay.render(false);
  expect(() => checkFileUploadSize(2 * MIB)).not.toThrow();
  direct.render(false);
  expect(() => checkFileUploadSize(2 * MIB)).toThrow('1 MB');
});
