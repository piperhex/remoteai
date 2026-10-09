import { invoke } from '@tauri-apps/api/core';
import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopDisplays, DesktopSettings, DesktopSignal, DesktopSignalReply }
  from '../../../../shared/remote-desktop/protocol';
import { openDesktopCapture } from './displays';
import { desktopFailure } from '../../../../shared/remote-desktop/diagnostics';
import type { ConnectionDiagnostic, DiagnosticFields } from '../../../../shared/remote-chat/diagnostics';

const STATUS_INTERVAL = 2000;

function profile(settings: DesktopSettings) {
  const profiles = { auto: { width: 1920, bitrate: 6_000_000 }, smooth: { width: 854, bitrate: 1_500_000 },
    clear: { width: 1920, bitrate: 8_000_000 }, original: { width: 2560, bitrate: 12_000_000 } };
  return { ...profiles[settings.quality], fps: settings.fps === 'auto' ? 60 : settings.fps,
    codec: settings.videoCodecs?.includes('h265') ? 'h265' : 'h264',
    adaptiveFps: settings.fps === 'auto' };
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
        id: this.id, profile: profile(this.settings), clipboardChannel: this.settings.clipboardChannel === true,
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
    await invoke('remote_desktop_stream_update', { id: this.id, profile: profile(settings) });
    this.settings = settings;
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
