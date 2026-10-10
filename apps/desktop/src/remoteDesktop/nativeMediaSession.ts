import type { IceServer } from '../../../../shared/remote-chat/protocol';
import type { DesktopSettings, DesktopSignal } from '../../../../shared/remote-desktop/protocol';
import type { NativeMediaFactory, NativeMediaSession } from '../../../../shared/remote-desktop/nativeMedia';
import { closeNativeMedia, openNativeMedia, nativeMediaIceServers }
  from '../../../../shared/remote-desktop/nativeMedia';
import type { ConnectionDiagnostic } from '../../../../shared/remote-chat/diagnostics';
import type { DesktopHostSession } from './host';

interface Options {
  id: string;
  iceServers: IceServer[];
  settings: DesktopSettings;
  media?: NativeMediaFactory;
  create: (iceServers: IceServer[]) => DesktopHostSession;
  diagnostic?: ConnectionDiagnostic;
}

/** Native credentials stay on the host. Only the supported capability crosses the encrypted RPC. */
export class NativeMediaHostSession implements DesktopHostSession {
  private session?: DesktopHostSession;
  private media?: NativeMediaSession;
  private stopped = false;
  private closing?: Promise<void>;
  constructor(private readonly options: Options) {}
  async open() {
    if (this.options.settings.nativeMedia) {
      this.media = await openNativeMedia(this.options.media, this.options.id, this.options.diagnostic);
    }
    if (this.stopped) { await closeNativeMedia(this.media); throw new Error('桌面连接已结束。'); }
    this.session = this.options.create(nativeMediaIceServers(this.options.iceServers, this.media?.endpoint));
    try {
      const offer = await this.session.open();
      if (this.stopped) throw new Error('桌面连接已结束。');
      return { ...offer, iceServers: this.options.iceServers, nativeMedia: Boolean(this.media) };
    } catch (error) { await this.close(); throw error; }
  }
  async signal(signal: DesktopSignal) {
    if (!this.session || this.stopped) throw new Error('桌面连接已结束。');
    return this.session.signal(signal);
  }
  async update(settings: DesktopSettings) { await this.session?.update(settings); }
  async privacy(enabled: boolean) {
    if (!this.session?.privacy || this.stopped) throw new Error('这台电脑暂不支持隐私屏。');
    return this.session.privacy(enabled);
  }
  async renew(expiresAt: number) { await this.session?.renew?.(expiresAt); }
  get closed() { return this.stopped || this.session?.closed === true; }
  close() {
    this.stopped = true;
    this.closing ??= this.cleanup();
    return this.closing;
  }
  private async cleanup() {
    try { await this.session?.close(); }
    finally { await closeNativeMedia(this.media); this.media = undefined; }
  }
}
