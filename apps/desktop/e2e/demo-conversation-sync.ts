import type { SyncRequest } from '../../../shared/conversation/sync/types';

/** Synchronous discovery replies match the demo host's structured-clone boundary. */
export function demoConversationSync(input: unknown) {
  const request = input as SyncRequest;
  if (request.action === 'homes') return { name: 'Remote PC', homes: [
    { id: 'default', path: 'D:/Users/demo/.codex', enabled: true },
    { id: 'codex-gui', path: 'D:/Remote AI/.codex', enabled: false },
  ] };
  if (request.action === 'list') return [{ sessionId: 'remote-sync', sessionKind: 'conversation',
    title: '排查项目中的登录问题', cwd: 'F:/projects/remoteai', updatedAt: 1_799_999_000,
    sizeBytes: 2048, matchExcerpt: null }];
  throw new Error('Unexpected demo sync request');
}
