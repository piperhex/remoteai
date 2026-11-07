import { invoke } from '../api/backend';
import { getChatPolicy } from '../../../../shared/remote-chat/policy';
import { SyncRelayRate } from '../../../../shared/conversation/sync/rate';
import { SYNC_CHUNK_BYTES, type SyncBundle, type SyncRequest }
  from '../../../../shared/conversation/sync/types';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';

export class RemoteConversationSync {
  private readonly owners = new Map<string, Set<string>>();
  private readonly rates = new Map<string, SyncRelayRate>();

  async request(body: Record<string, unknown>, options: { owner: string; mode: ConnectionMode }) {
    const request = body.request as SyncRequest | undefined;
    if (!request || typeof request !== 'object') {
      throw new Error('CONVERSATION_SYNC_INVALID');
    }
    const ids = this.owners.get(options.owner) ?? new Set<string>();
    this.owners.set(options.owner, ids);
    if ('id' in request && !ids.has(request.id)) throw new Error('CONVERSATION_SYNC_INVALID');
    if (request.action === 'read' || request.action === 'write') {
      const rate = this.rates.get(options.owner) ?? new SyncRelayRate();
      this.rates.set(options.owner, rate);
      await rate.wait(SYNC_CHUNK_BYTES, { direct: () => options.mode === 'direct',
        kibPerSecond: () => getChatPolicy().conversationSyncRelayKbps });
    }
    const result = await invoke<unknown>('codex_conversation_sync', { request });
    if (this.owners.get(options.owner) !== ids) {
      if (request.action === 'prepare' || request.action === 'export' || request.action === 'begin') {
        await invoke('codex_conversation_sync', { request: { action: 'close', id: (result as SyncBundle).id } });
      }
      throw new Error('CONVERSATION_SYNC_CLOSED');
    }
    if (request.action === 'prepare' || request.action === 'export' || request.action === 'begin') {
      ids.add((result as SyncBundle).id);
    }
    if (request.action === 'close') ids.delete(request.id);
    return result;
  }

  release(owner?: string) {
    for (const [id, transfers] of this.owners) {
      if (owner !== undefined && id !== owner) continue;
      for (const transfer of transfers) {
        void invoke('codex_conversation_sync', { request: { action: 'close', id: transfer } })
          .catch(() => { /* Expiration also removes abandoned bundles. */ });
      }
      this.owners.delete(id); this.rates.delete(id);
    }
  }
}
