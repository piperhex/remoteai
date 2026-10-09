import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopSettings, DesktopSignal } from '../../../../shared/remote-desktop/protocol';
import { DesktopHostSession } from './session';
import { NativeDesktopSession } from './nativeSession';
import type { ConnectionDiagnostic } from '../../../../shared/remote-chat/diagnostics';

/** Keep a working capture fallback for Windows installations without a supported native encoder. */
export class HostSession {
  private session: DesktopHostSession | NativeDesktopSession;
  private stopped = false;
  constructor(private settings: DesktopSettings, private readonly iceServers: IceServer[], private expiresAt?: number,
    private readonly diagnostic?: ConnectionDiagnostic) {
    this.session = new NativeDesktopSession(settings, iceServers, expiresAt, diagnostic);
  }
  async open() {
    try {
      return this.offer(await this.session.open());
    }
    catch (error) {
      const fallback = !(this.session instanceof NativeDesktopSession) || this.session.allowsCaptureFallback;
      await this.session.close();
      if (this.stopped) throw new Error('桌面连接已结束。');
      if (!fallback) throw error;
      this.session = new DesktopHostSession(this.settings, this.iceServers, this.expiresAt, this.diagnostic);
      return this.offer(await this.session.open());
    }
  }
  private offer(offer: Awaited<ReturnType<NativeDesktopSession['open']>>) {
    const policy = offer.permissions;
    return { ...offer, capabilities: { platform: offer.platform,
      keyboard: policy?.control ?? true, control: policy?.control ?? true,
      clipboard: !policy || policy.clipboardRead || policy.clipboardWrite, horizontalScroll: policy?.control ?? true } };
  }
  signal(signal: DesktopSignal) { return this.session.signal(signal); }
  async renew(expiresAt: number) { this.expiresAt = expiresAt; await this.session.renew(expiresAt); }
  async update(settings: DesktopSettings) { await this.session.update(settings); this.settings = settings; }
  get closed() { return this.stopped || this.session.closed; }
  close() { this.stopped = true; return this.session.close(); }
}
