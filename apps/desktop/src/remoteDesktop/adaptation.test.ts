import { describe, expect, it } from 'vitest';
import { DesktopAdaptation } from '../../../../shared/remote-desktop/adaptation';
import { desktopProfile, lowerDesktopProfile, raiseDesktopProfile } from '../../../../shared/remote-desktop/profiles';
import { DEFAULT_SETTINGS, validateSettings, type DesktopSettings } from '../../../../shared/remote-desktop/protocol';

function congest(adaptation: DesktopAdaptation) {
  for (let index = 0; index < 3; index++) adaptation.sample({ loss: 0.1 });
  return adaptation.profile();
}
function recover(adaptation: DesktopAdaptation) {
  for (let index = 0; index < 3; index++) adaptation.sample({ loss: 0, rtt: 0.02 });
  return adaptation.profile();
}

describe('remote desktop display adaptation', () => {
  it('starts at the highest supported resolution and 60 FPS', () => {
    expect(new DesktopAdaptation().profile()).toEqual({ width: 2560, fps: 60, bitrate: 12_000_000 });
  });

  it('uses the selected display width without creating oversized resolution steps', () => {
    const adaptation = new DesktopAdaptation();
    adaptation.update(DEFAULT_SETTINGS, { displayId: 'second', displays: [
      { id: 'primary', name: '4K', primary: true, width: 3840, height: 2160 },
      { id: 'second', name: '1080p', primary: false, width: 1920, height: 1080 },
    ] });
    expect(adaptation.profile()).toEqual({ width: 1920, fps: 60, bitrate: 12_000_000 });
    for (let index = 0; index < 3; index++) expect(congest(adaptation).width).toBe(1920);
    expect(congest(adaptation).width).toBe(1280);
    expect(recover(adaptation)).toMatchObject({ width: 1920, fps: 30 });
  });

  it('lowers frames before resolution and keeps the same per-frame pixel budget', () => {
    const adaptation = new DesktopAdaptation();
    for (const fps of [50, 40, 30]) {
      expect(congest(adaptation)).toEqual({ width: 2560, fps, bitrate: fps * 200_000 });
    }
    expect(congest(adaptation)).toEqual({ width: 1920, fps: 30, bitrate: 3_375_000 });
    expect(congest(adaptation)).toMatchObject({ width: 1280, fps: 30 });
    expect(congest(adaptation)).toMatchObject({ width: 854, fps: 30 });
    expect(congest(adaptation)).toMatchObject({ width: 854, fps: 20 });
    expect(congest(adaptation)).toMatchObject({ width: 854, fps: 15 });
  });

  it('restores resolution before high frame rates and requires three healthy samples', () => {
    const adaptation = new DesktopAdaptation();
    for (let index = 0; index < 5; index++) congest(adaptation);
    expect(adaptation.profile()).toMatchObject({ width: 1280, fps: 30 });
    for (let index = 0; index < 2; index++) {
      adaptation.sample({ loss: 0 });
      expect(adaptation.profile().width).toBe(1280);
    }
    adaptation.sample({ loss: 0 });
    expect(adaptation.profile()).toMatchObject({ width: 1920, fps: 30 });
    expect(recover(adaptation)).toMatchObject({ width: 2560, fps: 30 });
    for (const fps of [40, 50, 60]) expect(recover(adaptation).fps).toBe(fps);
    expect(recover(adaptation)).toEqual(desktopProfile(DEFAULT_SETTINGS));
  });

  it('treats a custom frame rate as a ceiling and retains manually selected quality', () => {
    const settings: DesktopSettings = { fps: 45, quality: 'clear' };
    const adaptation = new DesktopAdaptation(settings);
    expect(congest(adaptation)).toMatchObject({ width: 1920, fps: 35 });
    expect(congest(adaptation)).toMatchObject({ width: 1920, fps: 30 });
    const reduced = congest(adaptation);
    expect(reduced).toMatchObject({ width: 1920, fps: 30 });
    expect(reduced.bitrate).toBeLessThan(8_000_000 * 30 / 45);
    for (let index = 0; index < 10; index++) recover(adaptation);
    expect(adaptation.profile()).toEqual(desktopProfile(settings));
  });

  it.each(['smooth', 'clear', 'original'] as const)('retains manual %s resolution through congestion', quality => {
    for (const fps of ['auto', 60, 30] as const) {
      const settings: DesktopSettings = { fps, quality };
      const requested = desktopProfile(settings), adaptation = new DesktopAdaptation(settings);
      for (let index = 0; index < 40; index++) expect(congest(adaptation).width).toBe(requested.width);
      for (let index = 0; index < 80; index++) recover(adaptation);
      expect(adaptation.profile()).toEqual(requested);
    }
  });

  it('restores and locks manual resolution selected after automatic downscaling', () => {
    const adaptation = new DesktopAdaptation();
    for (let index = 0; index < 6; index++) congest(adaptation);
    expect(adaptation.profile().width).toBe(854);
    adaptation.update({ quality: 'original', fps: 'auto' });
    expect(adaptation.profile().width).toBe(2560);
    for (let index = 0; index < 40; index++) expect(congest(adaptation).width).toBe(2560);
  });

  it.each([1, 24, 30])('preserves manual frame caps at %i FPS when reducing resolution', fps => {
    const adaptation = new DesktopAdaptation({ fps, quality: 'auto' });
    expect(congest(adaptation)).toMatchObject({ width: 1920, fps });
    expect(recover(adaptation)).toMatchObject({ width: 2560, fps });
  });

  it('does not change load without measurements, and waits between reductions', () => {
    const adaptation = new DesktopAdaptation();
    for (let index = 0; index < 3; index++) adaptation.sample({ limited: 'cpu' });
    expect(adaptation.profile().fps).toBe(50);
    for (let index = 0; index < 10; index++) adaptation.sample({});
    expect(adaptation.profile().fps).toBe(50);
    adaptation.sample({ bitrate: 100_000, sentBitrate: 10_000_000 });
    expect(adaptation.profile().fps).toBe(50);
    for (let index = 0; index < 2; index++) adaptation.sample({ bitrate: 100_000, sentBitrate: 10_000_000 });
    expect(adaptation.profile().fps).toBe(40);
  });

  it('applies changed settings immediately without resetting on unrelated updates', () => {
    const adaptation = new DesktopAdaptation();
    congest(adaptation);
    adaptation.update({ ...DEFAULT_SETTINGS, clipboardChannel: true });
    expect(adaptation.profile().fps).toBe(50);
    adaptation.update({ quality: 'clear', fps: 90 });
    expect(adaptation.profile()).toEqual({ width: 1920, fps: 90, bitrate: 8_000_000 });
    adaptation.update(DEFAULT_SETTINGS);
    expect(adaptation.profile()).toEqual(desktopProfile(DEFAULT_SETTINGS));
  });

  it.each([31, 90, 144])('recovers after deep congestion without exceeding %i FPS', fps => {
    const settings: DesktopSettings = { fps, quality: 'auto' };
    const requested = desktopProfile(settings);
    let current = requested;
    for (let index = 0; index < 50; index++) current = lowerDesktopProfile(current, requested, settings);
    expect(current.bitrate).toBeGreaterThanOrEqual(200_000);
    for (let index = 0; index < 80; index++) current = raiseDesktopProfile(current, requested);
    expect(current).toEqual(requested);
  });

  it('rejects malformed settings', () => {
    for (const fps of [0, -1, 145, 1.5, Infinity, '30', null]) {
      expect(() => validateSettings({ fps, quality: 'auto' })).toThrow();
    }
    expect(() => validateSettings({ fps: 30, quality: 'invalid' })).toThrow();
    expect(validateSettings({ fps: 1, quality: 'smooth' })).toEqual({ fps: 1, quality: 'smooth' });
  });
});
