import { invoke } from '../api/backend';
import { getChatPolicy } from '../../../../shared/remote-chat/policy';
import { SyncRelayRate } from '../../../../shared/conversation/sync/rate';
import { SYNC_CHUNK_BYTES, SYNC_LEGACY_CHUNK_BYTES, type SyncBundle, type SyncRequest }
  from '../../../../shared/conversation/sync/types';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';
import type { ChatLink } from '../../../../shared/remote-chat/link';
import { isNativeSyncRequest } from './syncTransfer';

export class RemoteConversationSync {
  private readonly owners = new Map<string, Set<string>>();
  private readonly rates = new Map<string, SyncRelayRate>();
  private readonly links = new Map<string, ChatLink>();
  private readonly jobs = new Map<string, Set<string>>();
  attach(owner: string, link: ChatLink) { this.links.set(owner, link); }

  async request(body: Record<string, unknown>, options: { owner: string; mode: ConnectionMode }) {
    const request = body.request as SyncRequest | undefined;
    if (!request || typeof request !== 'object') {
      throw new Error('CONVERSATION_SYNC_INVALID');
    }
    const ids = this.owners.get(options.owner) ?? new Set<string>();
    this.owners.set(options.owner, ids);
    if (isNativeSyncRequest(request)) return this.native(request, options, ids);
    if ('id' in request && request.action !== 'resume' && !ids.has(request.id)) {
      throw new Error('CONVERSATION_SYNC_INVALID');
    }
    if (request.action === 'read' || request.action === 'write') {
      const rate = this.rates.get(options.owner) ?? new SyncRelayRate();
      this.rates.set(options.owner, rate);
      const bytes = request.action === 'read' ? Math.min(SYNC_CHUNK_BYTES, request.length ?? SYNC_LEGACY_CHUNK_BYTES)
        : Math.min(SYNC_CHUNK_BYTES, Math.ceil(request.data.length * 3 / 4));
      await rate.wait(bytes, { direct: () => options.mode === 'direct',
        kibPerSecond: () => getChatPolicy().conversationSyncRelayKbps });
    }
    const result = await invoke<unknown>('codex_conversation_sync', { request });
    if (this.owners.get(options.owner) !== ids) {
      if (request.action === 'prepare' || request.action === 'export' || request.action === 'begin') {
        await invoke('codex_conversation_sync', { request: { action: 'close', id: (result as SyncBundle).id } });
      }
      throw new Error('CONVERSATION_SYNC_CLOSED');
    }
    if (request.action === 'prepare' || request.action === 'export' || request.action === 'begin'
      || request.action === 'resume') {
      ids.add((result as SyncBundle).id);
    }
    if (request.action === 'close') ids.delete(request.id);
    return result;
  }

  release(owner?: string) {
    for (const id of new Set([...this.owners.keys(), ...this.links.keys()])) {
      if (owner !== undefined && id !== owner) continue;
      // Disconnecting revokes this session's handles; durable bundles can only be
      // reclaimed with their separate resume capability, or expire after seven days.
      this.owners.delete(id); this.rates.delete(id);
      this.links.delete(id);
      for (const job of this.jobs.get(id) ?? []) void invoke('codex_conversation_sync_native_close', { id: job })
        .catch(() => { /* Native workers also stop when their RTC peer closes. */ });
      this.jobs.delete(id);
    }
  }

  private async native(request: SyncRequest, options: { owner: string; mode: ConnectionMode }, ids: Set<string>) {
    if (request.action === 'nativeStart') {
      const link = this.links.get(options.owner), target = link?.nativeSyncHandle, cipher = link?.nativeCipher;
      if (!ids.has(request.id) || options.mode !== 'direct' || !target || !cipher) {
        throw new Error('CONVERSATION_SYNC_INVALID');
      }
      const { id, action: _action, ...parameters } = request;
      const job = await invoke<string>('codex_conversation_sync_native_start', { request: {
        ...parameters, bundle: id, target, cipher: await cipher.handle,
      } });
      if (this.owners.get(options.owner) !== ids) {
        await invoke('codex_conversation_sync_native_close', { id: job });
        throw new Error('CONVERSATION_SYNC_CLOSED');
      }
      const jobs = this.jobs.get(options.owner) ?? new Set<string>();
      jobs.add(job); this.jobs.set(options.owner, jobs); return job;
    }
    if ((request.action !== 'nativePoll' && request.action !== 'nativeClose')
      || !this.jobs.get(options.owner)?.has(request.id)) throw new Error('CONVERSATION_SYNC_INVALID');
    if (request.action === 'nativePoll') return invoke('codex_conversation_sync_native_poll', { id: request.id });
    await invoke('codex_conversation_sync_native_close', { id: request.id });
    this.jobs.get(options.owner)?.delete(request.id);
  }
}
