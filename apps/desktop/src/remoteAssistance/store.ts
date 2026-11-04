import { invoke } from '@tauri-apps/api/core';
import type { DesktopPermissions } from '../../../../shared/remote-desktop/protocol';
import type { GuiCloudIdentity } from '../../../../shared/conversation/remote/types';
import { rememberRevocation, revokedInvitations } from './revocations';
import type { LoungeAccount } from '../../../../shared/lounge/types';

export interface AssistanceInvitation {
  id: string; hostDeviceId: string; hostName: string; hostEmail: string; helperEmail: string;
  helperDeviceId?: string; state: 'pending' | 'accepted' | 'declined' | 'ended' | 'expired'; expiresAt: string;
}
interface Reply { identity: GuiCloudIdentity; currentDeviceId: string; requests: AssistanceInvitation[] }
type Command = { kind: 'list' } | { kind: 'invite'; email: string }
  | { kind: 'inviteAccount'; userId: string }
  | { kind: 'respond'; id: string; action: 'accept' | 'decline' | 'end' };
interface Snapshot {
  authenticated: boolean; dialog: boolean; busy: boolean; error: string; requests: AssistanceInvitation[]; email: string;
  recipient?: LoungeAccount;
  identity?: GuiCloudIdentity; currentDeviceId?: string; viewerId?: string;
}
const INITIAL: Snapshot = { authenticated: false, dialog: false, busy: false, error: '', requests: [], email: '' };

export function liveInvitation(request: AssistanceInvitation) {
  return (request.state === 'pending' || request.state === 'accepted') && Date.parse(request.expiresAt) > Date.now();
}

/** The host reads this local consent record before opening a cross-account session. */
export class AssistanceStore {
  private state = INITIAL;
  private listeners = new Set<() => void>();
  private revoked = revokedInvitations();
  private generation = 0;
  private revision = 0;
  private polling = false;
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  reset(authenticated: boolean) {
    this.generation++;
    for (const id of revokedInvitations()) this.revoked.add(id);
    this.state = { ...INITIAL, authenticated };
    this.listeners.forEach(listener => listener());
  }
  open = () => this.update({ dialog: true, error: '' });
  setEmail = (email: string) => this.update({ email });
  /** Targeted chat entries call this only after the user confirms the recipient. */
  request = (user?: LoungeAccount) => {
    if (this.state.busy || this.state.requests.some(request =>
      request.hostDeviceId === this.state.currentDeviceId && liveInvitation(request))) {
      this.open(); return;
    }
    this.update({ dialog: true, error: '', email: '', recipient: user });
    if (user) void this.inviteSelected();
  };
  dismiss = () => this.update({ dialog: false });
  view = (id: string) => { if (!this.revoked.has(id)) this.update({ viewerId: id, dialog: false }); };
  allows(id: string) {
    return !this.revoked.has(id) && this.state.requests.some(request => request.id === id
      && request.hostDeviceId === this.state.currentDeviceId && liveInvitation(request));
  }
  async refresh() {
    if (!this.state.authenticated || this.polling || this.state.busy) return;
    const generation = this.generation, revision = this.revision;
    this.polling = true;
    try {
      const reply = await invoke<Reply>('remote_assistance', { request: { kind: 'list' } });
      if (generation === this.generation && revision === this.revision) this.update(reply);
    } catch {
      // A transient poll failure must not turn into repeated dialogs or revoke a valid direct connection.
    } finally { this.polling = false; }
  }
  async invite(email: string) {
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
      this.update({ error: '请输入有效的邮箱地址。' }); return false;
    }
    return this.execute({ kind: 'invite', email: normalized });
  }
  async inviteSelected() {
    const recipient = this.state.recipient;
    return recipient ? this.execute({ kind: 'inviteAccount', userId: recipient.id }) : this.invite(this.state.email);
  }
  async respond(id: string, action: 'accept' | 'decline' | 'end') {
    if (action === 'end') {
      // Local cancellation stops capture even while the cloud is unreachable.
      this.revoked.add(id);
      rememberRevocation(id, this.state.requests.find(item => item.id === id)?.expiresAt);
      this.update({ viewerId: this.state.viewerId === id ? undefined : this.state.viewerId });
    }
    return this.execute({ kind: 'respond', id, action });
  }
  private async execute(request: Exclude<Command, { kind: 'list' }>) {
    if (this.state.busy) return false;
    if (!this.state.authenticated) { this.update({ error: '请先登录，再使用远程协助。' }); return false; }
    const generation = this.generation;
    this.revision++;
    this.update({ busy: true, error: '' });
    try {
      if (request.kind === 'invite' || request.kind === 'inviteAccount') {
        const permissions = await invoke<DesktopPermissions>('remote_desktop_permissions');
        if (!permissions.enabled || !permissions.control) {
          throw new Error('请先在设置中允许远程桌面和键鼠控制。');
        }
      }
      if (generation !== this.generation) return false;
      const reply = await invoke<Reply>('remote_assistance', { request });
      if (generation !== this.generation) return false;
      const changed = new Set(reply.requests.map(item => item.id));
      const requests = [...this.state.requests.filter(item => !changed.has(item.id)), ...reply.requests];
      this.update({ ...reply, requests, ...(request.kind === 'respond' && request.action === 'accept'
        ? { viewerId: request.id, dialog: false } : {}) });
      return true;
    } catch (error) {
      if (generation === this.generation) this.update({ error: typeof error === 'string' ? error
        : error instanceof Error ? error.message : '远程协助暂不可用，请稍后重试。' });
      return false;
    } finally { if (generation === this.generation) this.update({ busy: false }); }
  }
}

export const assistanceStore = new AssistanceStore();
