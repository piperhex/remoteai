import { object, type IceServer } from '../../../../shared/remote-chat/protocol';
import { validateSettings, type DesktopOffer, type DesktopSettings, type DesktopSignal, type DesktopSignalReply }
  from '../../../../shared/remote-desktop/protocol';
import { HostSession } from './hostSession';
import type { ConnectionDiagnostic } from '../../../../shared/remote-chat/diagnostics';
import type { NativeMediaFactory } from '../../../../shared/remote-desktop/nativeMedia';
import { NativeMediaHostSession } from './nativeMediaSession';
import { desktopPermissionStatus } from './permissions';

export interface DesktopHostSession {
  readonly closed: boolean;
  open(): Promise<DesktopOffer>;
  close(): unknown;
  signal(signal: DesktopSignal): Promise<DesktopSignalReply>;
  update(settings: DesktopSettings): Promise<void>;
  renew?(expiresAt: number): Promise<void>;
}

/** Owner and ICE configuration come only from the authenticated coordinator. */
export class RemoteDesktopHost {
  constructor(private readonly createSession: (settings: DesktopSettings, ice: IceServer[], expiresAt?: number,
    diagnostic?: ConnectionDiagnostic) => DesktopHostSession
    = (settings, ice, expiresAt, diagnostic) => new HostSession(settings, ice, expiresAt, diagnostic)) {}
  private peers = new Map<string, {
    ice: IceServer[]; expiresAt?: number; diagnostic?: ConnectionDiagnostic; media?: NativeMediaFactory;
  }>();
  private active?: { owner: string; id: string; session: DesktopHostSession };
  register(owner: string, iceServers: IceServer[], expiresAt?: number) {
    const expiry = typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? expiresAt : this.peers.get(owner)?.expiresAt;
    this.peers.set(owner, { ...this.peers.get(owner), ice: iceServers, expiresAt: expiry });
    if (this.active?.owner === owner && expiry) {
      const active = this.active;
      void active.session.renew?.(expiry).catch(() => active.session.close());
    }
  }
  diagnose(owner: string, diagnostic: ConnectionDiagnostic) {
    const peer = this.peers.get(owner);
    if (peer) peer.diagnostic = (event, fields) => diagnostic(event, { ...fields, scope: 'desktop' });
  }
  nativeMedia(owner: string, media: NativeMediaFactory) {
    const peer = this.peers.get(owner);
    if (peer) peer.media = media;
  }
  async request(value: unknown, owner: string) {
    const body = object(value);
    const peer = this.peers.get(owner);
    if (!peer) throw new Error('请先连接电脑。');
    if (body.action === 'permissions') {
      if (peer.expiresAt !== undefined && peer.expiresAt <= Date.now()) throw new Error('桌面连接已结束。');
      return desktopPermissionStatus();
    }
    if (typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(body.id)) {
      throw new Error('桌面连接信息无效，请重新连接。');
    }
    if (body.action === 'open') return this.open({ owner, id: body.id, settings: body.settings, iceServers: peer.ice });
    const active = this.active;
    if (!active || active.owner !== owner || active.id !== body.id) {
      if (body.action === 'close') return;
      throw new Error('桌面连接已结束，请重新连接。');
    }
    switch (body.action) {
      case 'close':
        await active.session.close();
        if (this.active === active) this.active = undefined;
        return;
      case 'settings': await active.session.update(validateSettings(body.settings)); return;
      case 'signal': return active.session.signal(body as unknown as DesktopSignal);
      default: throw new Error('不支持的远程桌面操作。');
    }
  }
  private async open(input: { owner: string; id: string; settings: unknown; iceServers: IceServer[] }) {
    const settings = validateSettings(input.settings);
    if (this.active && !this.active.session.closed) {
      throw new Error('已有远程桌面连接，请先关闭后再试。');
    }
    const previous = this.active?.session;
    const peer = this.peers.get(input.owner);
    const session = new NativeMediaHostSession({ id: input.id, settings, iceServers: input.iceServers,
      media: peer?.media, diagnostic: peer?.diagnostic,
      create: ice => this.createSession(settings, ice, peer?.expiresAt, peer?.diagnostic) });
    this.active = { owner: input.owner, id: input.id, session };
    try {
      // Capture may expire before the viewer's close RPC arrives; release its native adapter too.
      if (previous) await previous.close();
      return await session.open();
    }
    catch (error) {
      session.close();
      if (this.active?.session === session) this.active = undefined;
      if (typeof error === 'string') throw new Error(error);
      throw error;
    }
  }
  release(owner?: string) {
    if (owner === undefined) this.peers.clear(); else this.peers.delete(owner);
    if (this.active && (owner === undefined || this.active.owner === owner)) {
      this.active.session.close(); this.active = undefined;
    }
  }
}
