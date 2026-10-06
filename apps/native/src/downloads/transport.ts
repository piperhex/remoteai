import type { DownloadClient } from '../../../../shared/remote-chat/downloads';
import type { DownloadNative, DownloadRequest } from './types';
import { BulkError, bulkAssert } from '../../../../shared/remote-chat/bulkLimits';

const preparing = new Map<string, AbortController>();

async function forwardOpen(options: { request: DownloadRequest; client: DownloadClient; native: DownloadNative }) {
  const { request, client, native } = options;
  const { taskId } = request;
  const controller = new AbortController();
  preparing.get(taskId)?.abort(); preparing.set(taskId, controller);
  try { await openFile({ request, client, native, signal: controller.signal }); }
  finally { if (preparing.get(taskId) === controller) preparing.delete(taskId); }
}

async function openFile(options: {
  request: DownloadRequest; client: DownloadClient; native: DownloadNative; signal: AbortSignal;
}) {
  const { request, client, native, signal } = options;
  const { source, taskId, requestId } = request;
  const info = await client.open({ transferId: taskId, scope: source.scope,
    threadId: source.threadId, cwd: source.cwd, path: source.path, preview: source.preview });
  let accepted = false;
  let bulk: Awaited<ReturnType<typeof import('./bulkOpen')['openNativeBulk']>> | undefined;
  try {
    bulkAssert(!signal.aborted, 'CANCELLED');
    if (native.bulkBinaryAvailable && client.bulk?.available()) {
      const { openNativeBulk } = await import('./bulkOpen');
      bulk = await openNativeBulk({ taskId, id: info.id, client: client.bulk, native, signal });
    }
    accepted = await native.accept(requestId, JSON.stringify(bulk ? { ...info, bulk } : info), false);
  } finally {
    if (!accepted) {
      if (bulk) await client.bulk?.cancel(taskId, bulk.epoch);
      await client.close(taskId, info.id);
    }
  }
}

/** Native tasks own the bounded read window; JS only forwards encrypted RPCs without decoding file bytes. */
export async function forwardDownloadRequest(options: {
  request: DownloadRequest; client?: DownloadClient; native: DownloadNative;
}) {
  const { request, client, native } = options;
  const { taskId, requestId, remoteId } = request;
  if (request.operation === 'cancelOpen') { preparing.get(taskId)?.abort(); return; }
  if (request.operation === 'bulkCancel') { await client?.bulk?.cancel(taskId, request.epoch!); return; }
  if (request.operation === 'close') {
    await client?.close(taskId, remoteId).catch(() => console.warn('Remote download handle will expire.'));
    return;
  }
  try {
    if (!client) throw new Error('Disconnected');
    if (request.operation === 'bulkRead') {
      if (!client.bulk) throw new Error('Disconnected');
      await client.bulk.request({ transferId: taskId, epoch: request.epoch!, manifestId: request.manifestId!,
        requestId, requestNumber: request.requestNumber!, block: request.block!, granted: request.granted! });
      await native.accept(requestId, '{}', false); return;
    }
    if (request.operation === 'open') {
      await forwardOpen({ request, client, native });
      return;
    }
    const chunk = await client.read({ threadId: taskId, id: remoteId, offset: request.offset, length: request.length });
    await native.accept(requestId, JSON.stringify(chunk), false);
  } catch (error) {
    const failure = error instanceof BulkError ? JSON.stringify({ code: error.code }) : null;
    await native.accept(requestId, failure, true);
  }
}
