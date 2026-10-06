import { imagePreviewByteLimit, imagePreviewCharLimit } from '../../../../shared/remote-chat/policy';
import { guiApi } from '../pages/codexGui/api';
import type { Thread } from '../pages/codexGui/types';
import { contentHash } from '../../../../shared/remote-chat/historySync';
import { isInlineImage } from '../../../../shared/chat/imageSources';
import type { ConnectionMode } from '../../../../shared/remote-chat/protocol';

const IMAGE_PREFIX = 'chat-image://';
const CHUNK_CHARS = 256 * 1024;
const CACHE_CHARS = 64 * 1024 * 1024;

/** Inline originals stay on the PC. History contains only stable, task-scoped references. */
export class RemoteImages {
  private readonly sources = new Map<string, string>();
  private readonly images = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly hashes = new Map<string, string>();

  private remember(threadId: string, source: string) {
    const reference = `${IMAGE_PREFIX}${contentHash(source)}`;
    this.sources.set(JSON.stringify([threadId, reference]), source);
    this.trim(this.sources);
    return reference;
  }

  prepare<T>(value: T, threadId: string): T {
    const visit = (entry: unknown): unknown => {
      if (typeof entry === 'string') {
        if (isInlineImage(entry)) return this.remember(threadId, entry);
        return entry.replace(/data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+/gi,
          (source) => this.remember(threadId, source));
      }
      if (Array.isArray(entry)) return entry.map(visit);
      if (!entry || typeof entry !== 'object') return entry;
      const record = entry as Record<string, unknown>;
      const result = { ...record };
      if (record.type === 'imageGeneration' && typeof record.result === 'string'
        && /^[a-z0-9+/=]+$/i.test(record.result)) result.result = `data:image/png;base64,${record.result}`;
      return Object.fromEntries(Object.entries(result).map(([key, data]) => [key, visit(data)]));
    };
    return visit(value) as T;
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
    if (!source.startsWith(IMAGE_PREFIX)) return source;
    const key = JSON.stringify([threadId, source]);
    if (!this.sources.has(key)) {
      const { thread } = await guiApi.request<{ thread: Thread }>({ operation: 'read', threadId });
      this.prepare(thread, threadId);
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
