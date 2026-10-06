import { PreviewDownloads } from '../../../../shared/remote-chat/previewDownloads';
import { downloadManager } from './manager';
import { downloadContent } from './storage';
import { verifySnapshot } from './saveDownload';
import type { DownloadTask } from './types';

export function createPreviewDownloads(identity: { owner: string; deviceId: string }) {
  const urls = new Map<string, Promise<string>>();
  const revoke = (url: Promise<string>) => {
    void url.then(value => URL.revokeObjectURL(value), () => { /* A failed load did not create a URL. */ });
  };
  const content = async (task: DownloadTask) => {
    const blob = await downloadContent(task);
    await verifySnapshot(task, blob);
    return blob;
  };
  const previews = new PreviewDownloads({
    initialize: downloadManager.initialize, snapshot: downloadManager.snapshot,
    subscribe: downloadManager.subscribe, connection: downloadManager.connection, error: downloadManager.error,
    enqueue: source => downloadManager.enqueue(source), resume: id => downloadManager.resume(id),
    remove: id => downloadManager.remove(id), save: task => downloadManager.save(task.id),
    text: async task => new TextDecoder('utf-8', { fatal: true }).decode(await (await content(task)).arrayBuffer()),
    image: async task => {
      const existing = urls.get(task.id);
      if (existing) return existing;
      const url = content(task).then(blob => {
        if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error('图片加载失败，请重试。');
        return URL.createObjectURL(blob);
      });
      urls.set(task.id, url); return url;
    },
    release: id => { const url = urls.get(id); if (url) revoke(url); urls.delete(id); },
  }, identity);
  return { image: previews.image, text: previews.text, saveImage: previews.saveImage,
    dispose: () => { previews.dispose(); urls.forEach(revoke); urls.clear(); } };
}
