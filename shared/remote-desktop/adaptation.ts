import { DEFAULT_SETTINGS, type DesktopDisplays, type DesktopSettings } from './protocol';
import { desktopProfile, lowerDesktopProfile, raiseDesktopProfile, type DesktopProfile } from './profiles';

export interface NetworkSample {
  bitrate?: number; sentBitrate?: number; rtt?: number; loss?: number; limited?: 'bandwidth' | 'cpu'; routeId?: string;
}
const HEALTHY_SAMPLES = 3;
const CONGESTED_SAMPLES = 3;
const CHANGE_COOLDOWN = 2;
const BUSY_BITRATE_RATIO = 0.7;
const CAPACITY_SHORTAGE_RATIO = 0.8;
const RTT_INCREASE_LIMIT = 0.15;
const RTT_RECOVERY_MARGIN = 0.05;

/** Share the native host's frame-first policy with the browser capture fallback. */
export class DesktopAdaptation {
  private settings: DesktopSettings;
  private requested: DesktopProfile;
  private current: DesktopProfile;
  private healthy = 0;
  private congested = 0;
  private congestedLoss = 0;
  private cooldown = 0;
  private baselineRtt?: number;
  private routeId?: string;
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
      this.healthy = 0; this.congested = 0; this.congestedLoss = 0; this.cooldown = 0;
    }
    this.settings = settings; this.displays = displays;
  }

  sample(sample: NetworkSample) {
    if (sample.routeId !== undefined && sample.routeId !== this.routeId) {
      this.resetNetwork(); this.routeId = sample.routeId;
    }
    this.cooldown = Math.max(0, this.cooldown - 1);
    if (sample.rtt !== undefined && Number.isFinite(sample.rtt) && sample.rtt >= 0) {
      this.baselineRtt = Math.min(this.baselineRtt ?? sample.rtt, sample.rtt);
    }
    const networkPressure = this.networkPressure(sample);
    this.trackCongestion(sample, networkPressure || sample.limited === 'cpu');
    if (this.congested || this.congestedLoss) {
      this.healthy = 0;
      if (this.cooldown || Math.max(this.congested, this.congestedLoss) < CONGESTED_SAMPLES) return;
      const lossPressure = this.congestedLoss >= CONGESTED_SAMPLES;
      this.congested = 0; this.congestedLoss = 0;
      const next = lowerDesktopProfile(this.current, this.requested, this.settings);
      // Spending fewer bits cannot fix a pixel-processing limit once manual frame/size limits are reached.
      const sameLoad = next.width === this.current.width && next.fps === this.current.fps;
      if (!networkPressure && !lossPressure && sameLoad) return;
      this.change(next);
      return;
    }
    if (sample.loss === undefined) return;
    const healthy = sample.loss < 0.01
      && (sample.rtt ?? 0) <= (this.baselineRtt ?? 0) + RTT_RECOVERY_MARGIN;
    this.healthy = healthy ? this.healthy + 1 : 0;
    if (this.healthy >= HEALTHY_SAMPLES && !this.cooldown) {
      this.healthy = 0;
      const next = raiseDesktopProfile(this.current, this.requested);
      const capacity = sample.bitrate;
      if (this.busy(sample) && capacity !== undefined && capacity > 0 && capacity < next.bitrate) return;
      this.change(next);
    }
  }

  private trackCongestion(sample: NetworkSample, pressure: boolean) {
    // Loss reports arrive less often than local stats. Neither stream may erase the other's evidence.
    if (sample.loss !== undefined) this.congestedLoss = sample.loss > 0.05 ? this.congestedLoss + 1 : 0;
    if (sample.bitrate !== undefined || sample.rtt !== undefined || sample.limited !== undefined) {
      this.congested = pressure ? this.congested + 1 : 0;
    }
  }

  private busy(sample: NetworkSample) {
    return sample.sentBitrate !== undefined && sample.sentBitrate >= this.current.bitrate * BUSY_BITRATE_RATIO;
  }

  private networkPressure(sample: NetworkSample) {
    // A configured maximum is not the bandwidth required by a quiet desktop. Estimates alone also
    // reflect the browser's own bitrate cap, so they must be corroborated by sustained encoder demand.
    const shortage = this.busy(sample) && sample.bitrate !== undefined && sample.bitrate > 0
      && sample.bitrate < sample.sentBitrate! * CAPACITY_SHORTAGE_RATIO;
    const delay = sample.rtt !== undefined && this.baselineRtt !== undefined
      && sample.rtt > this.baselineRtt + RTT_INCREASE_LIMIT;
    return shortage || delay;
  }

  resetNetwork() {
    this.baselineRtt = undefined; this.routeId = undefined;
    this.healthy = 0; this.congested = 0; this.congestedLoss = 0; this.cooldown = 0;
  }

  private change(next: DesktopProfile) {
    if (next.width === this.current.width && next.fps === this.current.fps && next.bitrate === this.current.bitrate) return;
    this.current = next; this.cooldown = CHANGE_COOLDOWN;
  }

  profile() { return this.current; }
}
