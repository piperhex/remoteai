import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NativeRtcConnection } from './connection';
import type { NativeRtcEvent } from './types';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
let deliver: (events: NativeRtcEvent[]) => void;
const peers: NativeRtcConnection[] = [];

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'native_rtc_open') return 'peer-handle';
    if (command === 'native_rtc_poll') return new Promise<NativeRtcEvent[]>(resolve => { deliver = resolve; });
    return null;
  });
});
afterEach(() => { peers.splice(0).forEach(peer => peer.close()); vi.unstubAllGlobals(); });

async function peer() {
  const result = new NativeRtcConnection({ iceServers: [{ urls: ['stun:fixture.test'] }] });
  peers.push(result);
  await vi.waitFor(() => expect(result.id).toBe('peer-handle'));
  return result;
}

it('owns signaling in Rust and never constructs the browser RTC implementation', async () => {
  const browser = vi.fn(() => { throw new Error('Unexpected browser WebRTC'); });
  vi.stubGlobal('RTCPeerConnection', browser);
  const connection = await peer();
  const channel = connection.createDataChannel('remote-ai-file-v1', { negotiated: true, id: 42 });
  await connection.createOffer();
  expect(browser).not.toHaveBeenCalled();
  const operations = mocks.invoke.mock.calls.filter(([command]) => command === 'native_rtc_operation');
  expect(operations.map(([, body]) => body.request.operation.kind)).toEqual(['createChannel', 'offer']);
  deliver([{ kind: 'open', key: channel.spec.key }]);
  await vi.waitFor(() => expect(channel.nativeRtcHandle).toEqual({ peer: 'peer-handle', channel: channel.spec.key }));
});

it('preserves incoming channel open ordering and closes channels when the backend disappears', async () => {
  const connection = await peer();
  const key = crypto.randomUUID();
  let incoming: { readyState: string } | undefined;
  connection.addEventListener('datachannel', event => { incoming = (event as Event & { channel: typeof incoming }).channel; });
  deliver([{ kind: 'open', key }, { kind: 'channel', channel: { key, label: 'codex-chat-v1' } }]);
  await vi.waitFor(() => expect(incoming?.readyState).toBe('open'));
  deliver([{ kind: 'closed' }]);
  await vi.waitFor(() => expect(incoming?.readyState).toBe('closed'));
  expect(mocks.invoke).toHaveBeenCalledWith('native_rtc_close', { id: 'peer-handle' });
});

it('releases a native handle that opens after the view was disposed', async () => {
  let finish!: (id: string) => void;
  mocks.invoke.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  const connection = new NativeRtcConnection({}); peers.push(connection); connection.close(); finish('late');
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('native_rtc_close', { id: 'late' }));
  expect(mocks.invoke).not.toHaveBeenCalledWith('native_rtc_poll', expect.anything());
});

it('converts native stats timestamps from seconds to RTC milliseconds', async () => {
  const connection = await peer();
  mocks.invoke.mockImplementationOnce(async () => ({ transport: {
    id: 'transport', type: 'transport', timestamp: 12.5,
  } }));
  const stats = await connection.getStats();
  expect(stats.get('transport')?.timestamp).toBe(12500);
});
