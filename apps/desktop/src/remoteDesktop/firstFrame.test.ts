import { afterEach, expect, it, vi } from 'vitest';
import { DesktopReceiver } from '../../../../shared/remote-desktop/receiver';
import { DEFAULT_SETTINGS } from '../../../../shared/remote-desktop/protocol';

afterEach(() => vi.useRealTimers());

async function connection() {
  vi.useFakeTimers();
  const events = new Map<string, EventListener>();
  let frames = 0;
  const pc = { addEventListener: vi.fn((name: string, callback: EventListener) => events.set(name, callback)),
    removeEventListener: vi.fn(), close: vi.fn(), setRemoteDescription: vi.fn(),
    createAnswer: vi.fn(async () => ({ sdp: 'answer' })), setLocalDescription: vi.fn(),
    connectionState: 'connecting', iceGatheringState: 'complete',
    getStats: vi.fn(async () => new Map([['video', { id: 'video', type: 'inbound-rtp', kind: 'video',
      timestamp: Date.now(), bytesReceived: 1000, framesDecoded: frames, frameWidth: 2560, frameHeight: 1440 }]])) };
  const options = { client: { open: vi.fn(async () => ({ sdp: 'offer', iceServers: [] })),
    signal: vi.fn(async () => ({ candidates: [] })), settings: vi.fn(), close: vi.fn() },
    createPeer: () => pc as unknown as RTCPeerConnection, stream: vi.fn(), stats: vi.fn(), status: vi.fn(),
    connected: vi.fn(), failed: vi.fn() };
  const receiver = new DesktopReceiver(options);
  await receiver.start(DEFAULT_SETTINGS);
  const track = { id: 'video', kind: 'video' };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  events.get('track')!(Object.assign(new Event('track'), { track, streams: [stream] }));
  pc.connectionState = 'connected'; events.get('connectionstatechange')!(new Event('connectionstatechange'));
  await vi.advanceTimersByTimeAsync(0);
  return { receiver, options, pc, stream, frames: (value: number) => { frames = value; } };
}

it('waits for a decoded frame after ICE connects, then retains the picture through idle stats', async () => {
  const { receiver, options, frames } = await connection();
  await vi.advanceTimersByTimeAsync(5000);
  expect(options.status).toHaveBeenLastCalledWith('正在加载桌面画面…');
  expect(options.connected).not.toHaveBeenCalled();
  frames(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(options.status).toHaveBeenLastCalledWith('');
  expect(options.connected).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(options.failed).not.toHaveBeenCalled();
  expect(options.connected).toHaveBeenCalledOnce();
  await receiver.stop(); expect(vi.getTimerCount()).toBe(0);
});

it('closes and reports a timeout when connected media never produces a decoded frame', async () => {
  const { receiver, options, pc } = await connection();
  await vi.advanceTimersByTimeAsync(25_000);
  expect(options.failed).toHaveBeenCalledWith('获取屏幕画面超时，请重新连接。');
  expect(options.connected).not.toHaveBeenCalled();
  expect(pc.close).toHaveBeenCalledOnce();
  await receiver.stop(); expect(options.client.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels first-frame waiting when the viewer closes before decoding', async () => {
  const { receiver, options, stream } = await connection();
  await receiver.stop();
  receiver.frameRendered(stream);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(options.failed).not.toHaveBeenCalled();
  expect(options.connected).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('accepts a rendered frame with missing decode stats, but ignores stale streams', async () => {
  const { receiver, options, pc, stream } = await connection();
  pc.getStats.mockResolvedValue(new Map());
  receiver.frameRendered(undefined);
  receiver.frameRendered({} as MediaStream);
  expect(options.connected).not.toHaveBeenCalled();
  receiver.frameRendered(stream);
  expect(options.status).toHaveBeenLastCalledWith('');
  expect(options.connected).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(options.failed).not.toHaveBeenCalled();
  await receiver.stop(); expect(vi.getTimerCount()).toBe(0);
});
