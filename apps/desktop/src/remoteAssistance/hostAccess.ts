import { DESKTOP_OPERATION } from '../../../../shared/remote-desktop/protocol';
import { object, type RpcRequest, type RpcResponse } from '../../../../shared/remote-chat/protocol';
import { assistanceStore } from './store';

/** Coordinator labels are immutable; encrypted peer requests cannot choose their own scope. */
export class AssistanceHostAccess {
  private sessions = new Map<string, string>();
  private unsubscribe: () => void;
  constructor(private readonly drop: (id: string) => void) {
    this.unsubscribe = assistanceStore.subscribe(() => {
      for (const [session, invitation] of this.sessions) if (!assistanceStore.allows(invitation)) this.drop(session);
    });
  }
  admit(session: string, invitation: unknown) {
    if (invitation === undefined) return true;
    if (typeof invitation !== 'string' || !assistanceStore.allows(invitation)) return false;
    this.sessions.set(session, invitation);
    return true;
  }
  restricted(session: string) { return this.sessions.has(session); }
  denied(session: string, request: RpcRequest): RpcResponse | undefined {
    const invitation = this.sessions.get(session);
    if (!invitation) return undefined;
    const body = object(request.body);
    if (assistanceStore.allows(invitation) && request.method === 'request'
      && body.operation === DESKTOP_OPERATION && body.action !== 'privacy') return undefined;
    return { kind: 'response', id: request.id, error: '本次协助仅允许远程桌面操作。' };
  }
  release(session: string) { this.sessions.delete(session); }
  reset() { this.sessions.clear(); }
  close() { this.unsubscribe(); this.reset(); }
}
