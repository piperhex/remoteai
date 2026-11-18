import { imagePreviewByteLimit, imagePreviewCharLimit } from '../../../../shared/remote-chat/policy';
import { guiApi } from '../../../../shared/conversation/api';
import type { Thread } from '../../../../shared/conversation/types';
import { contentHash } from '../../../../shared/remote-chat/historySync';
import { historyImageReference, isHistoryImageReference, replaceInlineImages, type HistoryImageReference }
  from '../../../../shared/remote-chat/historyImages';
import { isInlineImage } from '../../../../shared/chat/imageSources';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';

const CHUNK_CHARS = 256 * 1024;
const CACHE_CHARS = 64 * 1024 * 1024;

/** Inline originals stay on the PC. History contains only stable, task-scoped references. */
export class RemoteImages {
  private readonly sources = new Map<string, string>();
  private readonly images = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly hashes = new Map<string, string>();

  rememberHistory(threadId: string, images: readonly HistoryImageReference[]) {
    for (const { reference, source } of images) {
      this.sources.set(JSON.stringify([threadId, reference]), source);
      this.trim(this.sources);
    }
  }

  prepare<T>(value: T, threadId: string, onImage?: (reference: string, source: string) => void): T {
    return replaceInlineImages(value, source => {
      const reference = historyImageReference(contentHash(source));
      this.rememberHistory(threadId, [{ reference, source }]);
      onImage?.(reference, source);
      return reference;
    });
  }

  private trim(cache: Map<string, string>) {
    let size = [...cache.values()].reduce((total, value) => total + value.length, 0);
    for (const [key, value] of cache) {
      // Keep the active original even when its configured limit exceeds the cache budget.
      if (size <= CACHE_CHARS || cache.size === 1) break;
      cache.delete(key);
      size -= value.length;
    }
  }

  private async resolve(threadId: string, source: string) {
    if (!isHistoryImageReference(source)) return source;
    const key = JSON.stringify([threadId, source]);
    if (!this.sources.has(key)) {
      const { thread } = await guiApi.request<{ thread: Thread }>({ operation: 'read', threadId });
      let recovered: string | undefined;
      // A long image history can evict the requested source again before traversal reaches its end.
      this.prepare(thread, threadId, (reference, original) => { if (reference === source) recovered = original; });
      if (recovered) return recovered;
    }
    const original = this.sources.get(key);
    if (!original) throw new Error('图片暂时无法加载，请重试。');
    return original;
  }

  async downloadSource(threadId: unknown, source: unknown) {
    if (typeof threadId !== 'string' || typeof source !== 'string') throw new Error('图片请求无效，请重试。');
    return this.resolve(threadId, source);
  }

  private load(threadId: string, source: string, variant: 'thumbnail' | 'original', mode: ConnectionMode) {
    const maxBytes = imagePreviewByteLimit(mode);
    const key = JSON.stringify([threadId, source, variant, maxBytes]);
    const cached = this.images.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = this.resolve(threadId, source).then(async (resolved) => {
      const { url } = await guiApi.request<{ url: string }>({ operation: 'imagePreview', threadId,
        source: resolved, variant, maxBytes });
      const limit = variant === 'thumbnail' ? 100_000 : imagePreviewCharLimit(mode);
      if (!isInlineImage(url) || url.length > limit) throw new Error('图片暂时无法加载，请重试。');
      this.images.set(key, url);
      this.trim(this.images);
      return url;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  async request(body: Record<string, unknown>, mode: ConnectionMode = 'relay') {
    const { threadId, source, offset = 0 } = body;
    if (typeof threadId !== 'string' || typeof source !== 'string' || !Number.isSafeInteger(offset)
      || Number(offset) < 0) throw new Error('图片请求无效，请重试。');
    const original = body.operation === 'imageChunk';
    const url = await this.load(threadId, source, original ? 'original' : 'thumbnail', mode);
    if (!original) return { url };
    if (Number(offset) >= url.length) throw new Error('图片请求已失效，请重试。');
    const key = JSON.stringify([threadId, source]);
    let hash = this.hashes.get(key);
    if (Number(offset) === 0 || !hash) {
      hash = contentHash(url);
      this.hashes.set(key, hash);
      if (this.hashes.size > 512) this.hashes.delete(this.hashes.keys().next().value!);
    }
    return { data: url.slice(Number(offset), Number(offset) + CHUNK_CHARS), total: url.length, hash };
  }
}
