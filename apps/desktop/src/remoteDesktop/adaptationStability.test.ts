import { expect, it } from 'vitest';
import { DesktopAdaptation } from '../../../../shared/remote-desktop/adaptation';

it.each(['auto', 'original'] as const)('keeps %s quality when a quiet screen uses little bandwidth', quality => {
  const adaptation = new DesktopAdaptation({ quality, fps: 60 });
  for (let index = 0; index < 60; index++) {
    adaptation.sample({ loss: 0, rtt: 0.02, bitrate: 300_000, sentBitrate: 600_000, limited: 'bandwidth' });
  }
  expect(adaptation.profile()).toEqual({ width: 2560, fps: 60, bitrate: 12_000_000 });
});

it('counts independent loss reports across intervening bandwidth samples', () => {
  const adaptation = new DesktopAdaptation();
  for (let index = 0; index < 2; index++) {
    adaptation.sample({ loss: 0.1, rtt: 0.007 });
    adaptation.sample({ bitrate: 20_000_000, rtt: 0.007 });
    expect(adaptation.profile().fps).toBe(60);
  }
  adaptation.sample({ loss: 0.1, rtt: 0.007 });
  expect(adaptation.profile().fps).toBe(50);
});

it('counts sustained capacity pressure across intervening loss reports', () => {
  const adaptation = new DesktopAdaptation();
  for (let index = 0; index < 2; index++) {
    adaptation.sample({ bitrate: 1_000_000, sentBitrate: 12_000_000 });
    adaptation.sample({ loss: 0 });
    expect(adaptation.profile().fps).toBe(60);
  }
  adaptation.sample({ bitrate: 1_000_000, sentBitrate: 12_000_000 });
  expect(adaptation.profile().fps).toBe(50);
});

it('does not treat a stable high-latency relay as congestion', () => {
  const adaptation = new DesktopAdaptation({ quality: 'clear', fps: 60 });
  for (let index = 0; index < 30; index++) {
    adaptation.sample({ loss: 0, rtt: 0.35, bitrate: 12_000_000, sentBitrate: 7_000_000 });
  }
  expect(adaptation.profile()).toEqual({ width: 1920, fps: 60, bitrate: 8_000_000 });
});

it('ignores an isolated loss or bandwidth dip instead of changing the encoder', () => {
  const adaptation = new DesktopAdaptation();
  adaptation.sample({ loss: 0.1, bitrate: 1_000_000, sentBitrate: 12_000_000 });
  expect(adaptation.profile()).toEqual({ width: 2560, fps: 60, bitrate: 12_000_000 });
  for (let index = 0; index < 10; index++) adaptation.sample({ loss: 0, bitrate: 20_000_000 });
  expect(adaptation.profile()).toEqual({ width: 2560, fps: 60, bitrate: 12_000_000 });
});

it('stabilizes at the available capacity instead of repeatedly raising and lowering FPS', () => {
  const adaptation = new DesktopAdaptation({ quality: 'original', fps: 60 });
  for (let index = 0; index < 9; index++) {
    adaptation.sample({ loss: 0, bitrate: 4_500_000, sentBitrate: adaptation.profile().bitrate });
  }
  expect(adaptation.profile()).toEqual({ width: 2560, fps: 30, bitrate: 6_000_000 });
  for (let index = 0; index < 30; index++) {
    adaptation.sample({ loss: 0, bitrate: 6_500_000, sentBitrate: 6_000_000 });
  }
  expect(adaptation.profile()).toEqual({ width: 2560, fps: 30, bitrate: 6_000_000 });
  for (let index = 0; index < 3; index++) {
    adaptation.sample({ loss: 0, bitrate: 12_000_000, sentBitrate: 6_000_000 });
  }
  expect(adaptation.profile()).toMatchObject({ fps: 40 });
});

it('does not sacrifice manual picture quality for CPU pressure at the minimum frame rate', () => {
  const adaptation = new DesktopAdaptation({ quality: 'clear', fps: 60 });
  for (let index = 0; index < 40; index++) adaptation.sample({ loss: 0, limited: 'cpu' });
  expect(adaptation.profile()).toEqual({ width: 1920, fps: 30, bitrate: 4_000_000 });
});

it('reacts to growing delay but learns a new baseline after switching routes', () => {
  const adaptation = new DesktopAdaptation({ quality: 'clear', fps: 60 });
  adaptation.sample({ routeId: 'direct', rtt: 0.02, loss: 0 });
  for (let index = 0; index < 3; index++) adaptation.sample({ routeId: 'direct', rtt: 0.25, loss: 0 });
  expect(adaptation.profile().fps).toBe(50);
  for (let index = 0; index < 6; index++) adaptation.sample({ routeId: 'relay', rtt: 0.35, loss: 0 });
  expect(adaptation.profile()).toEqual({ width: 1920, fps: 60, bitrate: 8_000_000 });
});
