import { DEFAULT_SETTINGS, type DesktopDisplays, type DesktopSettings } from './protocol';
import { desktopProfile, lowerDesktopProfile, raiseDesktopProfile, type DesktopProfile } from './profiles';

export interface NetworkSample { bitrate?: number; rtt?: number; loss?: number; limited?: boolean }
const HEALTHY_SAMPLES = 3;
const CHANGE_COOLDOWN = 2;

/** Share the native host's frame-first policy with the browser capture fallback. */
export class DesktopAdaptation {
  private settings: DesktopSettings;
  private requested: DesktopProfile;
  private current: DesktopProfile;
  private healthy = 0;
  private cooldown = 0;
  private displays: DesktopDisplays = {};

  constructor(settings = DEFAULT_SETTINGS) {
    this.settings = settings;
    this.requested = desktopProfile(settings);
    this.current = this.requested;
  }

  update(settings: DesktopSettings, displays = this.displays) {
    const requested = desktopProfile(settings, displays);
    if (settings.fps !== this.settings.fps || settings.quality !== this.settings.quality
      || requested.width !== this.requested.width) {
      this.requested = requested; this.current = this.requested;
      this.healthy = 0; this.cooldown = 0;
    }
    this.settings = settings; this.displays = displays;
  }

  sample(sample: NetworkSample) {
    this.cooldown = Math.max(0, this.cooldown - 1);
    const congested = (sample.rtt ?? 0) > 0.3 || (sample.loss ?? 0) > 0.05 || sample.limited
      || (sample.bitrate !== undefined && sample.bitrate < this.current.bitrate * 0.85);
    if (congested) {
      this.healthy = 0;
      if (!this.cooldown) this.change(lowerDesktopProfile(this.current, this.requested, this.settings));
      return;
    }
    // A capped sender needs small recovery probes; requiring the next cap would trap it at low quality.
    const healthy = (sample.loss !== undefined || sample.bitrate !== undefined)
      && (sample.rtt ?? 0) < 0.15 && (sample.loss ?? 0) < 0.01;
    this.healthy = healthy ? this.healthy + 1 : 0;
    if (this.healthy >= HEALTHY_SAMPLES && !this.cooldown) {
      this.healthy = 0; this.change(raiseDesktopProfile(this.current, this.requested));
    }
  }

  private change(next: DesktopProfile) {
    if (next.width === this.current.width && next.fps === this.current.fps && next.bitrate === this.current.bitrate) return;
    this.current = next; this.cooldown = CHANGE_COOLDOWN;
  }

  profile() { return this.current; }
}
