import { bulkCapability, type BulkClient } from '../../../../shared/remote-chat/bulkControl';
import { BULK_LIMITS, BulkError, bulkAssert } from '../../../../shared/remote-chat/bulkLimits';
import { BulkReceiver } from '../../../../shared/remote-chat/bulkReceiver';
import { authenticateManifest, blockLength, validateManifestPage }
  from '../../../../shared/remote-chat/downloadManifest';
import { negotiateBulk } from '../../../../shared/remote-chat/bulkProtocol';
import { checkDownloadSize } from '../../../../shared/remote-chat/policy';
import type { FileInfo } from '../../../../shared/remote-chat/fileDownload';
import { BulkBlockStore, readManifestPage, storeBulkCheckpoint, storeManifestPage } from './bulkStorage';
import { readStoredBlock, resetDownload, storeDownload } from './storage';
import { DownloadWorker } from './downloadWorker';
import type { DownloadTask } from './types';
import { DownloadSession } from '../../../../shared/remote-chat/downloadSession';
import { DownloadMetrics } from '../../../../shared/remote-chat/downloadMetrics';
import { restoreBulkTask } from './bulkResume';

interface Options {
  task: DownloadTask; info: FileInfo; client: BulkClient; signal: AbortSignal; update: (task: DownloadTask) => void;
}

async function verifyFile(task: DownloadTask, worker: DownloadWorker, signal: AbortSignal) {
  for (let block = 0; block < task.manifest!.blockCount; block += 1) {
    bulkAssert(!signal.aborted, 'CANCELLED');
    const blob = await readStoredBlock(task.id, block * task.manifest!.blockSize);
    bulkAssert(blob && blob.size === blockLength(task.manifest!, block), 'INTEGRITY_FAILED');
    await worker.update(new Uint8Array(await blob.arrayBuffer()));
  }
  await worker.finish(task.manifest!.fileHash);
}

async function missingBlocks(options: {
  task: DownloadTask; receiver: BulkReceiver; store: BulkBlockStore; signal: AbortSignal;
}) {
  const { task, receiver, store, signal } = options;
  const manifest = task.manifest!;
  const committed = new Set(task.checkpoint!.committed);
  let next = 0;
  const run = async () => {
    while (next < manifest.blockCount) {
      bulkAssert(!signal.aborted, 'CANCELLED'); checkDownloadSize(manifest.size);
      const block = next++;
      if (committed.has(block)) continue;
      const index = Math.floor(block / BULK_LIMITS.hashesPerPage);
      const page = validateManifestPage(manifest, await readManifestPage(task.id, index), index);
      await receiver.block({ block, hash: page.hashes[block % BULK_LIMITS.hashesPerPage],
        write: bytes => store.write(block, bytes) });
    }
  };
  const results = await Promise.allSettled([run(), run()]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

export async function transferBulkDownload(options: Options) {
  const { client, signal, info, update } = options;
  let task: DownloadTask = { ...options.task, status: 'preparing', verified: false };
  update(task);
  const path = client.path(); bulkAssert(path, 'PATH_UNAVAILABLE');
  const epoch = crypto.randomUUID();
  const session = new DownloadSession('bulk', epoch);
  const metrics = new DownloadMetrics();
  const preparing = performance.now();
  const opened = await client.open({ transferId: task.id, id: info.id, epoch, path,
    capability: bulkCapability('idb-atomic', client.transport()?.recordBytes) }, signal);
  let worker: DownloadWorker | undefined;
  let receiver: BulkReceiver | undefined;
  let store: BulkBlockStore | undefined;
  try {
    worker = new DownloadWorker();
    bulkAssert(opened.transferId === task.id && opened.epoch === epoch && opened.path === path, 'INVALID_MANIFEST');
    negotiateBulk(bulkCapability('idb-atomic'), opened.capability);
    bulkAssert(opened.manifest.size === info.size, 'SOURCE_CHANGED');
    await authenticateManifest({ manifest: opened.manifest, signal,
      read: page => client.page(task.id, page), store: page => storeManifestPage(task.id, page) });
    const changed = task.manifest && task.manifest.manifestId !== opened.manifest.manifestId;
    const importLegacy = !task.manifest && !task.checkpoint && task.received > 0;
    task = { ...task, manifest: opened.manifest };
    if (changed || (!task.checkpoint && !importLegacy)) {
      task = { ...task, received: 0, checkpoint: undefined }; await resetDownload(task);
      if (changed) { update(task); throw new BulkError('SOURCE_CHANGED'); }
    }
    task = { ...await restoreBulkTask({ task, worker, signal, importLegacy }), status: 'downloading', message: '' };
    session.move('downloading'); metrics.add('prepareMs', performance.now() - preparing);
    await storeBulkCheckpoint(task); update(task);
    await worker.initialize(client.cipher({ transferId: task.id, manifestId: opened.manifest.manifestId, epoch }));
    receiver = new BulkReceiver({ client, opened, signal, decoder: worker, metrics });
    const started = performance.now(); const initial = task.received;
    store = new BulkBlockStore(task, value => {
      task = { ...value, protocol: 'bulk', verified: false,
        bytesPerSecond: (value.received - initial) * 1000 / Math.max(1, performance.now() - started) };
      update(task);
    });
    await missingBlocks({ task, receiver, store, signal }); await store.close();
    task = { ...task, status: 'verifying', bytesPerSecond: undefined }; update(task);
    session.move('verifying');
    const verificationWorker = worker;
    await metrics.measure('verifyMs', () => verifyFile(task, verificationWorker, signal));
    session.fileVerified(); session.move('ready');
    task = { ...task, status: 'ready', verified: true }; await storeDownload(task); update(task);
  } finally {
    metrics.record();
    await receiver?.close();
    if (!receiver) await client.cancel(task.id, epoch).catch(() => undefined);
    try { await store?.close(); } finally { worker?.close(); }
  }
}
