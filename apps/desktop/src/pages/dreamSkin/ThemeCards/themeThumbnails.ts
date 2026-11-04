import { loadDreamSkinThemePreview } from '../../../api/backend';

const MAX_CONCURRENT = 2;
const MAX_CACHE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 24;
interface Request {
  id: string;
  signal: AbortSignal;
  resolve: (value: string | null) => void;
  reject: (error: unknown) => void;
}

/** Only small encoded thumbnails are cached; visible cards own their decoded image references. */
export class ThemeThumbnails {
  private cache = new Map<string, string>();
  private queued: Request[] = [];
  private running = 0;
  private owners = 0;

  constructor(private readonly read: (id: string) => Promise<string | null>) {}

  retain() {
    this.owners++;
    return () => { if (--this.owners === 0) this.cache.clear(); };
  }

  load(id: string, signal: AbortSignal): Promise<string | null> {
    if (signal.aborted) return Promise.resolve(null);
    const cached = this.cached(id);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.queued = this.queued.filter(entry => entry !== request);
        resolve(null);
      };
      const finish = () => signal.removeEventListener('abort', cancel);
      const request: Request = { id, signal,
        resolve: value => { finish(); resolve(value); },
        reject: error => { finish(); reject(error); } };
      signal.addEventListener('abort', cancel, { once: true });
      this.queued.push(request);
      this.pump();
    });
  }

  private cached(id: string) {
    const value = this.cache.get(id);
    if (value) { this.cache.delete(id); this.cache.set(id, value); }
    return value;
  }

  private remember(id: string, value: string) {
    if (!this.owners || value.length * 2 > MAX_CACHE_BYTES) return;
    this.cache.delete(id);
    this.cache.set(id, value);
    let bytes = [...this.cache.values()].reduce((sum, entry) => sum + entry.length * 2, 0);
    for (const [key, entry] of this.cache) {
      if (bytes <= MAX_CACHE_BYTES && this.cache.size <= MAX_CACHE_ENTRIES) break;
      this.cache.delete(key);
      bytes -= entry.length * 2;
    }
  }

  private pump() {
    while (this.running < MAX_CONCURRENT && this.queued.length) {
      const request = this.queued.shift()!;
      if (request.signal.aborted) { request.resolve(null); continue; }
      const cached = this.cached(request.id);
      if (cached) { request.resolve(cached); continue; }
      this.running++;
      void this.run(request);
    }
  }

  private async run(request: Request) {
    try {
      const value = await this.read(request.id);
      if (!request.signal.aborted && value) this.remember(request.id, value);
      request.resolve(request.signal.aborted ? null : value);
    } catch (error) { request.reject(error); }
    finally { this.running--; this.pump(); }
  }
}

export const themeThumbnails = new ThemeThumbnails(id => loadDreamSkinThemePreview(id, true));
