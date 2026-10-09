import type { DesktopDisplays, DesktopSettings } from './protocol';

export interface DesktopProfile { width: number; fps: number; bitrate: number }
export const DEFAULT_FPS = 60;
export const QUALITY_FPS_FLOOR = 30;
const FPS_STEP = 10;
const MIN_AUTO_FPS = 15;
const MIN_BITRATE = 200_000;
const RESOLUTIONS = [854, 1280, 1920, 2560] as const;
const QUALITY_PROFILES = {
  smooth: { width: 854, bitrate: 1_500_000 },
  clear: { width: 1920, bitrate: 8_000_000 },
  original: { width: 2560, bitrate: 12_000_000 },
} as const;

/** Automatic sessions start at the highest supported quality; capture never upscales the display. */
export function desktopProfile(settings: DesktopSettings, displays: DesktopDisplays = {}): DesktopProfile {
  const quality = QUALITY_PROFILES[settings.quality === 'auto' ? 'original' : settings.quality];
  const display = displays.displays?.find(display => display.id === displays.displayId)
    ?? displays.displays?.find(display => display.primary);
  return { ...quality, width: Math.min(quality.width, display?.width ?? quality.width),
    fps: settings.fps === 'auto' ? DEFAULT_FPS : settings.fps };
}

function bitrateFor(profile: DesktopProfile, requested: DesktopProfile) {
  return Math.max(MIN_BITRATE, Math.floor(requested.bitrate * (profile.width / requested.width) ** 2
    * profile.fps / requested.fps));
}

/** Spend fewer frames before spending fewer pixels, retaining the requested bits per pixel per frame. */
export function lowerDesktopProfile(current: DesktopProfile, requested: DesktopProfile, settings: DesktopSettings) {
  const next = { ...current };
  if (next.fps > QUALITY_FPS_FLOOR) next.fps = Math.max(QUALITY_FPS_FLOOR, next.fps - FPS_STEP);
  else if (settings.quality === 'auto' && next.width > RESOLUTIONS[0]) {
    next.width = [...RESOLUTIONS].reverse().find(width => width < next.width) ?? next.width;
  } else if (settings.fps === 'auto' && next.fps > MIN_AUTO_FPS) {
    next.fps = Math.max(MIN_AUTO_FPS, next.fps - FPS_STEP);
  } else return { ...next, bitrate: Math.max(MIN_BITRATE, Math.floor(next.bitrate * 0.7)) };
  next.bitrate = bitrateFor(next, requested);
  return next;
}

/** Restore image quality before raising frame rate above 30 FPS. */
export function raiseDesktopProfile(current: DesktopProfile, requested: DesktopProfile): DesktopProfile {
  const target = bitrateFor(current, requested);
  if (current.bitrate < target) return { ...current, bitrate: Math.min(target, Math.floor(current.bitrate * 1.25)) };
  const next = { ...current };
  const floor = Math.min(QUALITY_FPS_FLOOR, requested.fps);
  if (next.fps < floor) next.fps = Math.min(floor, next.fps + FPS_STEP);
  else if (next.width < requested.width) {
    next.width = Math.min(requested.width, RESOLUTIONS.find(width => width > next.width) ?? requested.width);
  } else next.fps = Math.min(requested.fps, next.fps + FPS_STEP);
  next.bitrate = bitrateFor(next, requested);
  return next;
}
