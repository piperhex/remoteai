import { useEffect, useState } from 'react';
import { isInlineImage, localImageSource } from '../../chat/imageSources';
import type { PreviewLoadOptions } from '../previewProgress';

export interface ImagePreviewOptions {
  threadId: string | null;
  ready: boolean;
  offline?: boolean;
  load: (threadId: string, source: string, original?: boolean, options?: PreviewLoadOptions) => Promise<string>;
  save?: (url: string) => Promise<void>;
}

export function useChatImage(source: string | undefined, options: ImagePreviewOptions | null) {
  const network = source && /^https?:\/\//i.test(source) ? source : undefined;
  const local = source ? (localImageSource(source)
    ?? (options?.load && network ? source : undefined)) : undefined;
  const remote = source && !local && (isInlineImage(source) || network) ? source : undefined;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; url?: string; failed?: boolean }>();
  const [failedKey, setFailedKey] = useState<string>();
  const { threadId, ready, offline, load } = options ?? {};
  const key = JSON.stringify([threadId, source, attempt]);
  useEffect(() => {
    if (!local || !threadId || (!ready && !offline) || !load) return;
    let cancelled = false;
    setResult(undefined);
    void load(threadId, local).then((url) => {
      const cached = /^(blob:|file:\/\/)/.test(url);
      if (!cancelled) setResult(isInlineImage(url) || cached ? { key, url } : { key, failed: true });
    }, () => { if (!cancelled) setResult({ key, failed: true }); });
    return () => { cancelled = true; };
  }, [local, threadId, ready, offline, load, key]);
  const current = result?.key === key ? result : undefined;
  const supported = Boolean(remote || (local && threadId && load));
  return {
    // Inline attachments already belong to the device; only remote previews have a managed transfer to export.
    save: remote ? undefined : options?.save,
    key, url: remote || current?.url, failed: current?.failed || failedKey === key || !supported,
    loading: Boolean(local && supported && !current),
    original: async (progress?: PreviewLoadOptions) => {
      if (remote) return remote;
      if (!threadId || !local || !load) throw new Error('图片暂时无法加载，请重试。');
      return load(threadId, local, true, progress);
    },
    fail: () => setFailedKey(key), retry: () => setAttempt((value) => value + 1),
  };
}
