import { afterEach, expect, it, vi } from 'vitest';
import { DesktopStatsSampler, desktopStatsLines } from '../../../../shared/remote-desktop/stats';
import { monitorDesktopStats } from '../../../../shared/remote-desktop/statsMonitor';

const reports = (video: Record<string, unknown>, route: Record<string, unknown> = {}) => new Map([
  ['video', { id: 'video', type: 'inbound-rtp', kind: 'video', ...video }],
  ['transport', { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' }],
  ['pair', { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote',
    currentRoundTripTime: 0.004 }],
  ['local', { id: 'local', type: 'local-candidate', candidateType: 'host', protocol: 'udp', networkType: 'wifi', ...route }],
  ['remote', { id: 'remote', type: 'remote-candidate', candidateType: 'host' }],
]);
const first = { timestamp: 1000, bytesReceived: 1000, framesDecoded: 10, totalDecodeTime: 0.02,
  packetsReceived: 100, packetsLost: 1, frameWidth: 1920, frameHeight: 1080 };

it('shows measured receiver rates, per-frame decode time, RTT, interval loss and the selected route', () => {
  const sampler = new DesktopStatsSampler();
  const initial = sampler.sample(reports(first));
  expect(initial.receivedBitrate).toBeUndefined(); expect(initial.receivedFps).toBeUndefined();
  const sample = sampler.sample(reports({ ...first, timestamp: 2000, bytesReceived: 251000,
    framesDecoded: 60, totalDecodeTime: 0.67, packetsReceived: 298, packetsLost: 3 }));
  expect(sample).toMatchObject({ width: 1920, height: 1080, receivedFps: 50, receivedBitrate: 2_000_000,
    rttMs: 4, lossPercent: 1, transport: 'UDP', connection: 'direct', network: 'Wi-Fi' });
  expect(sample.decodeMs).toBeCloseTo(13);
  expect(desktopStatsLines({ fps: 144, bitrate: 8_000_000, width: 0, height: 0, ...sample, elapsedSeconds: 3664 }))
    .toEqual(['01:01:04', 'UDP 直连', '50 fps', '2.0 Mbps', '4 ms 延迟', '13 ms 解码', '1.0% 丢包',
      '1920 × 1080', 'Wi-Fi']);
});

it('handles idle streams, counter resets and absent fields without inventing measured values', () => {
  const sampler = new DesktopStatsSampler(); sampler.sample(reports(first));
  const idle = sampler.sample(reports({ ...first, timestamp: 2000 }));
  expect(idle.receivedFps).toBe(0); expect(idle.receivedBitrate).toBe(0); expect(idle.decodeMs).toBeUndefined();
  const reset = sampler.sample(reports({ ...first, id: 'replacement', timestamp: 3000, framesDecoded: 1 }));
  expect(reset.receivedFps).toBeUndefined(); expect(reset.receivedBitrate).toBeUndefined();
  const unknown = desktopStatsLines({ fps: 144, bitrate: 8_000_000, width: 1920, height: 1080 });
  expect(unknown).toContain('— fps'); expect(unknown).toContain('— Mbps'); expect(unknown).toContain('— 网络');
});

it('reports a relay transport without guessing the local network type', () => {
  const sample = new DesktopStatsSampler().sample(reports(first,
    { candidateType: 'relay', relayProtocol: 'tls', networkType: undefined }));
  expect(sample).toMatchObject({ transport: 'TLS', connection: 'relay', network: undefined });
});

it.each([null, undefined, NaN, Infinity, -Infinity, '12', {}])(
  'renders missing or invalid measurements as unknown: %s', invalid => {
    // Native JSON and older hosts can supply values outside the TypeScript contract.
    const stats = { fps: 0, bitrate: 0, width: invalid, height: invalid, elapsedSeconds: invalid,
      receivedFps: invalid, receivedBitrate: invalid, rttMs: invalid, decodeMs: invalid, lossPercent: invalid };
    expect(desktopStatsLines(stats as unknown as Parameters<typeof desktopStatsLines>[0]))
      .toEqual(['00:00:00', '— —', '— fps', '— Mbps', '— ms 延迟', '— ms 解码', '—% 丢包', '—', '— 网络']);
  },
);

it('preserves measured zero values instead of treating them as missing', () => {
  expect(desktopStatsLines({ fps: 0, bitrate: 0, width: 0, height: 0, elapsedSeconds: 0,
    receivedFps: 0, receivedBitrate: 0, rttMs: 0, decodeMs: 0, lossPercent: 0 }))
    .toEqual(['00:00:00', '— —', '0 fps', '0.0 Mbps', '0 ms 延迟', '0 ms 解码', '0.0% 丢包', '—', '— 网络']);
});

afterEach(() => vi.useRealTimers());
it('measures decoder capability while showing only the capture method and negotiated codec', () => {
  const input = new Map<string, Record<string, unknown>>(
    reports({ ...first, codecId: 'hevc', powerEfficientDecoder: true }));
  input.set('hevc', { id: 'hevc', type: 'codec', mimeType: 'video/H265' });
  const stats = new DesktopStatsSampler().sample(input);
  expect(stats).toMatchObject({ videoCodec: 'h265', hardwareDecoding: true });
  expect(desktopStatsLines({ fps: 60, bitrate: 6_000_000, width: 1920, height: 1080,
    captureMethod: 'DXGI', hardwareEncoding: true, ...stats }).at(-1))
    .toBe('DXGI · H265');
});
it('keeps stats reads single-flight and ignores an in-flight result after closing', async () => {
  vi.useFakeTimers();
  let resolve!: (value: Map<string, Record<string, unknown>>) => void;
  const getStats = vi.fn(() => new Promise<Map<string, Record<string, unknown>>>(done => { resolve = done; }));
  const publish = vi.fn();
  const stop = monitorDesktopStats({ getStats } as unknown as RTCPeerConnection, publish);
  await vi.advanceTimersByTimeAsync(5000); expect(getStats).toHaveBeenCalledOnce();
  resolve(reports(first)); await vi.advanceTimersByTimeAsync(0); expect(publish).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000); expect(getStats).toHaveBeenCalledTimes(2);
  stop(); resolve(reports(first)); await vi.advanceTimersByTimeAsync(5000);
  expect(publish).toHaveBeenCalledOnce(); expect(getStats).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});
