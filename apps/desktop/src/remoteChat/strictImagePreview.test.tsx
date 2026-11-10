// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useImageViewer } from '../../../../shared/chat/useImageViewer';
import type { PreviewLoadOptions } from '../../../../shared/remote-chat/previewProgress';

it.each([false, true])('restarts a cancelled image request after cleanup (legacy signal=%s)', async legacy => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const NativeAbortController = globalThis.AbortController;
  if (legacy) vi.stubGlobal('AbortController', class extends NativeAbortController {
    constructor() { super(); Object.defineProperty(this.signal, 'throwIfAborted', { value: undefined }); }
  });
  const host = document.createElement('div');
  const root = createRoot(host);
  const load = vi.fn(async (options?: PreviewLoadOptions) => {
    if (options?.signal?.aborted) throw new Error('Cancelled');
    return 'blob:loaded-original';
  });
  function Fixture() {
    const viewer = useImageViewer(load, true);
    return <span>{viewer.url ?? (viewer.error ? 'failed' : 'loading')}</span>;
  }
  try {
    await act(async () => root.render(<StrictMode><Fixture /></StrictMode>));
    expect(host.textContent).toBe('blob:loaded-original');
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
