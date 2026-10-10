import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopSettings, DesktopSignal } from '../../../../shared/remote-desktop/protocol';
import { DesktopHostSession } from './session';
import { NativeDesktopSession } from './nativeSession';
import type { ConnectionDiagnostic } from '../../../../shared/remote-chat/diagnostics';
import { desktopFailure } from '../../../../shared/remote-desktop/diagnostics';

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
      if (!fallback || desktopFailure(error).reason === 'permission') throw error;
      this.diagnostic?.('desktop-stage', { stage: 'fallback-open', state: 'connecting' });
      try {
        this.session = new DesktopHostSession(this.settings, this.iceServers, this.expiresAt, this.diagnostic);
        const offer = this.offer(await this.session.open());
        this.diagnostic?.('desktop-stage', { stage: 'ready' });
        return offer;
      } catch (fallbackError) {
        this.diagnostic?.('desktop-failed', { ...desktopFailure(fallbackError), stage: 'fallback-open' });
        throw fallbackError;
      }
    }
  }
  private offer(offer: Awaited<ReturnType<NativeDesktopSession['open']>>) {
    const policy = offer.permissions;
    return { ...offer, capabilities: { platform: offer.platform,
      privacyScreen: this.session instanceof NativeDesktopSession && policy?.control !== false,
      keyboard: policy?.control ?? true, control: policy?.control ?? true,
      clipboard: !policy || policy.clipboardRead || policy.clipboardWrite, horizontalScroll: policy?.control ?? true } };
  }
  signal(signal: DesktopSignal) { return this.session.signal(signal); }
  async privacy(enabled: boolean) {
    if (!(this.session instanceof NativeDesktopSession)) throw new Error('这台电脑暂不支持隐私屏。');
    return this.session.privacy(enabled);
  }
  async renew(expiresAt: number) { this.expiresAt = expiresAt; await this.session.renew(expiresAt); }
  async update(settings: DesktopSettings) { await this.session.update(settings); this.settings = settings; }
  get closed() { return this.stopped || this.session.closed; }
  close() { this.stopped = true; return this.session.close(); }
}
