import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopResolution, DesktopSettings, DesktopSignal } from '../../../../shared/remote-desktop/protocol';
import { NativeDesktopSession } from './nativeSession';
import type { ConnectionDiagnostic } from '../../../../shared/remote-chat/diagnostics';
import type { DesktopCaptureSettings } from './displays';
import type { DesktopSecurityChange } from '../../../../shared/remote-desktop/security';

/** Desktop capture, encoding and WebRTC remain in the native backend. */
export class HostSession {
  private session: NativeDesktopSession;
  private stopped = false;
  constructor(private settings: DesktopCaptureSettings, private readonly iceServers: IceServer[], private expiresAt?: number,
    private readonly diagnostic?: ConnectionDiagnostic) {
    this.session = new NativeDesktopSession(settings, iceServers, expiresAt, diagnostic);
  }
  async open() { return this.offer(await this.session.open()); }
  private offer(offer: Awaited<ReturnType<NativeDesktopSession['open']>>) {
    const policy = offer.permissions;
    return { ...offer, capabilities: { platform: offer.platform, displaySessions: offer.displaySessions === true,
      security: !!offer.security && policy?.control === true,
      privacyScreen: policy?.control !== false,
      resolution: policy?.control !== false
        && !!offer.resolutions?.length,
      keyboard: policy?.control ?? true, control: policy?.control ?? true,
      inputFocus: policy?.control ?? true,
      clipboardNative: true,
      clipboardFiles: offer.platform === 'windows',
      clipboard: !policy || policy.clipboardRead || policy.clipboardWrite, horizontalScroll: policy?.control ?? true } };
  }
  signal(signal: DesktopSignal) { return this.session.signal(signal); }
  inputFocus() { return this.session.inputFocus(); }
  async security(change: DesktopSecurityChange) {
    return this.session.security(change);
  }
  async privacy(enabled: boolean) {
    return this.session.privacy(enabled);
  }
  async resolution(resolution: DesktopResolution) {
    return this.session.resolution(resolution);
  }
  async renew(expiresAt: number) { this.expiresAt = expiresAt; await this.session.renew(expiresAt); }
  async update(settings: DesktopSettings) { await this.session.update(settings); this.settings = settings; }
  get closed() { return this.stopped || this.session.closed; }
  close() { this.stopped = true; return this.session.close(); }
}
