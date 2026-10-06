import { PreviewDownloads } from '../../../../shared/remote-chat/previewDownloads';
import { downloadManager } from './manager';

export function createPreviewDownloads(identity: { owner: string; deviceId: string }) {
  return new PreviewDownloads({
    initialize: () => downloadManager.initialize(), snapshot: downloadManager.snapshot,
    subscribe: downloadManager.subscribe, connection: downloadManager.connection, error: downloadManager.error,
    enqueue: source => downloadManager.enqueue(source), resume: id => downloadManager.resume(id),
    remove: id => downloadManager.discardPreview(id), text: task => downloadManager.previewText(task.id),
    save: task => downloadManager.exportImage(task.id),
    image: async task => {
      if (!task.cacheUri || !/^image\/(png|jpeg|webp|gif)$/.test(task.mimeType ?? '')) {
        throw new Error('图片加载失败，请重试。');
      }
      return downloadManager.previewUri(task.id);
    },
  }, identity);
}
