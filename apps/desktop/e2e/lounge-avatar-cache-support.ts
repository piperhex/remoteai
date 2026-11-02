import { createHash } from 'node:crypto';
import type { WebSocketRoute } from '@playwright/test';

export class LoungeAvatarCacheFixture {
  enabled = false;
  transfers: { id: string; avatar: string }[] = [];
  watches: string[][] = [];
  private values = new Map<string, string>();
  private versions: Record<string, string> = {};
  private watched: string[] = [];
  private socket?: WebSocketRoute;

  set(id: string, avatar: string) {
    this.values.set(id, avatar);
    if (this.watched.includes(id)) this.synchronize([id]);
  }
  handle(socket: WebSocketRoute, frame: Record<string, unknown>) {
    if (!this.enabled) return false;
    this.socket = socket;
    if (frame.type === 'authenticate') { this.watched = []; this.versions = {}; }
    if (frame.type !== 'profile-watch') return false;
    const advertised = frame.avatarVersions as Record<string, string> ?? {};
    const next = frame.watch as string[];
    this.versions = Object.fromEntries(next.map(id => [id,
      this.watched.includes(id) ? this.versions[id] : advertised[id]]));
    this.watched = next;
    this.watches.push(this.watched);
    this.synchronize(this.watched);
    return true;
  }
  private synchronize(ids: string[]) {
    const profiles = ids.flatMap(id => {
      const avatar = this.values.get(id) ?? '';
      const version = createHash('sha256').update(avatar).digest('hex');
      if (this.versions[id] === version) return [];
      this.versions[id] = version;
      this.transfers.push({ id, avatar });
      return [{ id, avatar, version }];
    });
    if (profiles.length) this.socket?.send(JSON.stringify({ type: 'profiles', profiles }));
  }
}
