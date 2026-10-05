import type { DownloadClient } from '../../../../shared/remote-chat/downloads';
import type { DownloadNative, DownloadRequest } from './types';

/** Native tasks own the bounded read window; JS only forwards encrypted RPCs without decoding file bytes. */
export async function forwardDownloadRequest(options: {
  request: DownloadRequest; client?: DownloadClient; native: DownloadNative;
}) {
  const { request, client, native } = options;
  const { source, taskId, requestId, remoteId } = request;
  if (request.operation === 'close') {
    await client?.close(taskId, remoteId).catch(() => console.warn('Remote download handle will expire.'));
    return;
  }
  try {
    if (!client) throw new Error('Disconnected');
    if (request.operation === 'open') {
      const info = await client.open({ transferId: taskId, scope: source.scope,
        threadId: source.threadId, cwd: source.cwd, path: source.path });
      const accepted = await native.accept(requestId, JSON.stringify(info), false);
      // Pause/delete can win while open is in flight; close this late handle instead of leaking it.
      if (!accepted) await client.close(taskId, info.id);
      return;
    }
    const chunk = await client.read({ threadId: taskId, id: remoteId, offset: request.offset, length: request.length });
    await native.accept(requestId, JSON.stringify(chunk), false);
  } catch {
    await native.accept(requestId, null, true);
  }
}
