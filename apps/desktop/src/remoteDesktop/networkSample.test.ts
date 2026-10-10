import { expect, it } from 'vitest';
import { DesktopNetworkSampler, type RemoteLossReport } from './networkSample';

const outbound = (bytesSent: number, timestamp: number, id = 'video'): RTCOutboundRtpStreamStats => ({
  id, type: 'outbound-rtp', timestamp, bytesSent, ssrc: 1, kind: 'video',
});
const inbound = (roundTripTimeMeasurements: number, timestamp: number): RemoteLossReport => ({
  id: 'remote-video', timestamp, roundTripTimeMeasurements, fractionLost: 0.1,
});

it('measures actual traffic and starts a fresh window when the sender or its counters change', () => {
  const sampler = new DesktopNetworkSampler();
  expect(sampler.sentBitrate(outbound(1_000_000, 1000))).toBeUndefined();
  expect(sampler.sentBitrate(outbound(1_150_000, 3000))).toBe(600_000);
  expect(sampler.sentBitrate(outbound(1_150_000, 3000))).toBeUndefined();
  expect(sampler.sentBitrate(outbound(1000, 5000))).toBeUndefined();
  expect(sampler.sentBitrate(outbound(2000, 7000, 'new-video'))).toBeUndefined();
  sampler.reset();
  expect(sampler.sentBitrate(outbound(4000, 9000, 'new-video'))).toBeUndefined();
});

it('does not replay loss just because getStats has a newer timestamp', () => {
  const sampler = new DesktopNetworkSampler();
  expect(sampler.loss(inbound(3, 1000))).toBe(0.1);
  expect(sampler.loss(inbound(3, 3000))).toBeUndefined();
  expect(sampler.loss(inbound(4, 5000))).toBe(0.1);
  sampler.reset();
  expect(sampler.loss(inbound(4, 5000))).toBe(0.1);
});

it('uses report timestamps before round-trip measurements become available', () => {
  const sampler = new DesktopNetworkSampler();
  expect(sampler.loss(inbound(0, 1000))).toBe(0.1);
  expect(sampler.loss(inbound(0, 1000))).toBeUndefined();
  expect(sampler.loss(inbound(0, 3000))).toBe(0.1);
});
