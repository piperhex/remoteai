import { invoke } from '@tauri-apps/api/core';
import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopDisplays, DesktopResolution, DesktopSettings, DesktopSignal, DesktopSignalReply }
  from '../../../../shared/remote-desktop/protocol';
import { openDesktopCapture } from './displays';
import { desktopFailure } from '../../../../shared/remote-desktop/diagnostics';
import type { ConnectionDiagnostic, DiagnosticFields } from '../../../../shared/remote-chat/diagnostics';
import { desktopProfile } from '../../../../shared/remote-desktop/profiles';

const STATUS_INTERVAL = 2000;
const PRIVACY_POLL_INTERVAL = 250;
const PRIVACY_TIMEOUT = 50_000;
interface PrivacyProgress { ticket: string; pending: boolean; snapshot?: DesktopDisplays }

function profile(settings: DesktopSettings, displays: DesktopDisplays) {
  return { ...desktopProfile(settings, displays),
    codec: settings.videoCodecs?.includes('h265') ? 'h265' : 'h264',
    adaptiveFps: settings.fps === 'auto', adaptiveResolution: settings.quality === 'auto' };
}

/** The WebView holds signaling handles; native capture/encoding never returns pixels through IPC. */
export class NativeDesktopSession {
  private id?: string;
  private stopped = false;
  private closing?: Promise<void>;
  private displays: DesktopDisplays = {};
  private timer?: ReturnType<typeof setTimeout>;
  private lastDiagnostic = '';
  private nativeOnly = false;
  private changingPrivacy = false;
  get allowsCaptureFallback() { return !this.nativeOnly; }
  constructor(private settings: DesktopSettings, private readonly iceServers: IceServer[], private expiresAt?: number,
    private readonly diagnostic?: ConnectionDiagnostic) {}

  async open() {
    const started = performance.now();
    let stage: DiagnosticFields['stage'] = 'runtime-check';
    this.diagnostic?.('desktop-start', { transport: 'rtc' });
    try {
      this.diagnostic?.('desktop-stage', { stage, state: 'checking' });
      if (!await invoke<boolean>('remote_desktop_stream_available')) {
        throw new Error('远程桌面暂不可用，请更新电脑端应用后重试。');
      }
      if (this.stopped) throw new Error('桌面连接已结束。');
      stage = 'capture-open';
      this.diagnostic?.('desktop-stage', { stage, state: 'checking' });
      const { id, nativeOnly, ...displays } = await openDesktopCapture(this.settings.displayId, this.expiresAt);
      this.nativeOnly = nativeOnly === true;
      this.id = id; this.displays = displays;
      if (this.stopped) throw new Error('桌面连接已结束。');
      stage = 'stream-open';
      this.diagnostic?.('desktop-stage', { stage, state: 'connecting', ...this.captureDiagnostic() });
      const offer = await this.openStream();
      if (this.stopped) throw new Error('桌面连接已结束。');
      this.diagnostic?.('desktop-stage', { stage: 'ready', durationMs: performance.now() - started,
        ...this.captureDiagnostic() });
      this.schedule();
      return { ...offer, ...this.displays, iceServers: this.iceServers };
    } catch (error) {
      const fields = { durationMs: performance.now() - started, ...this.captureDiagnostic() };
      if (this.stopped) this.diagnostic?.('desktop-stage', { ...fields, stage: 'cancelled', reason: 'cancelled' });
      else this.diagnostic?.('desktop-failed', { ...desktopFailure(error), stage, ...fields });
      await this.closeNative();
      throw error;
    }
  }

  private captureDiagnostic(): DiagnosticFields {
    return { hostPlatform: this.displays.platform, displayCount: this.displays.displays?.length,
      desktopEnabled: this.displays.permissions?.enabled,
      ...(this.id ? { nativeOnly: this.nativeOnly } : {}) };
  }

  private openStream() {
    return invoke<{ sdp: string; directUpgrade?: boolean; relayStandby?: boolean }>(
      'remote_desktop_stream_open', { request: {
        id: this.id, profile: profile(this.settings, this.displays), clipboardChannel: this.settings.clipboardChannel === true,
        relayStandby: this.settings.relayStandby === true,
        iceServers: this.iceServers.map(server => ({ ...server,
          urls: Array.isArray(server.urls) ? server.urls : [server.urls] })),
      } });
  }

  signal(signal: DesktopSignal) {
    return invoke<DesktopSignalReply>('remote_desktop_stream_signal', {
      request: { ...signal, id: this.id },
    });
  }

  async update(settings: DesktopSettings) {
    await invoke('remote_desktop_stream_update', { id: this.id, profile: profile(settings, this.displays) });
    this.settings = settings;
  }
  async privacy(enabled: boolean): Promise<DesktopDisplays> {
    return this.changeDisplay({ enabled });
  }
  async resolution(resolution: DesktopResolution): Promise<DesktopDisplays> {
    return this.changeDisplay({ resolution });
  }
  private async changeDisplay(change: { enabled?: boolean; resolution?: DesktopResolution }): Promise<DesktopDisplays> {
    if (!this.id || this.stopped) throw new Error('桌面连接已结束。');
    if (this.changingPrivacy) throw new Error('正在调整显示，请稍候。');
    const failure = change.resolution ? '分辨率未能切换，请选择其他分辨率后重试。'
      : '隐私屏未能切换，请重新连接后重试。';
    this.changingPrivacy = true;
    let accepted = false;
    try {
      let progress = await invoke<PrivacyProgress>('remote_desktop_privacy', { id: this.id, ...change });
      accepted = true;
      const until = Date.now() + PRIVACY_TIMEOUT;
      while (progress.pending) {
        if (this.stopped || Date.now() >= until) throw new Error(failure);
        await new Promise(resolve => setTimeout(resolve, PRIVACY_POLL_INTERVAL));
        if (this.stopped) throw new Error('桌面连接已结束。');
        progress = await invoke<PrivacyProgress>('remote_desktop_privacy', { id: this.id, ticket: progress.ticket });
      }
      if (this.stopped) throw new Error('桌面连接已结束。');
      const snapshot = progress.snapshot;
      if (!snapshot || (change.enabled !== undefined && snapshot.privacyScreen !== change.enabled)) {
        throw new Error(failure);
      }
      const display = snapshot.displays?.find(item => item.id === snapshot.displayId);
      if (change.resolution && (display?.width !== change.resolution.width
        || display?.height !== change.resolution.height)) throw new Error(failure);
      this.displays = { ...this.displays, ...snapshot };
      this.settings = { ...this.settings, displayId: snapshot.displayId };
      await this.update(this.settings);
      return snapshot;
    } catch (error) {
      // Once accepted, an ambiguous result cannot leave a hidden privacy session running.
      if (accepted) await this.close();
      if (desktopFailure(error).desktopError === 'unknown') {
        throw new Error(failure);
      }
      throw typeof error === 'string' ? new Error(error) : error;
    } finally { this.changingPrivacy = false; }
  }
  async renew(expiresAt: number) {
    this.expiresAt = expiresAt;
    if (this.id && !this.stopped) await invoke('remote_desktop_renew', { id: this.id, expiresAt });
  }

  private schedule() {
    this.timer = setTimeout(() => { void this.refresh(); }, STATUS_INTERVAL);
  }

  private async refresh() {
    if (this.stopped) return;
    // The native transaction retains the lease and heartbeat. Avoid queuing status RPCs
    // behind a first-time driver installation in the service worker.
    if (this.changingPrivacy) { this.schedule(); return; }
    let stage: DiagnosticFields['stage'] = 'lease-renew';
    try {
      if (this.expiresAt !== undefined) await this.renew(this.expiresAt);
      stage = 'status';
      const status = await invoke<{ closed: boolean; ice?: DiagnosticFields }>(
        'remote_desktop_stream_status', { id: this.id });
      if (this.stopped) return;
      const key = JSON.stringify(status.ice);
      if (status.ice && key !== this.lastDiagnostic) {
        this.lastDiagnostic = key;
        this.diagnostic?.('ice-summary', { ...status.ice, transport: 'rtc' });
      }
      if (status.closed) this.close();
    } catch (error) {
      if (this.stopped) return;
      this.diagnostic?.('desktop-failed', { ...desktopFailure(error), stage }); this.close();
    }
    if (!this.stopped) this.schedule();
  }

  get closed() { return this.stopped; }
  close() {
    this.stopped = true; clearTimeout(this.timer); return this.closeNative();
  }
  private async closeNative() {
    const id = this.id;
    if (!id) return this.closing;
    this.id = undefined;
    this.closing = invoke<void>('remote_desktop_stream_close', { id }).catch(async () => {
      // Old hosts lack the stream command. The native input lease still needs explicit release.
      await invoke('remote_desktop_close', { id }).catch(() => { /* The native lease also expires. */ });
    });
    return this.closing;
  }
}
