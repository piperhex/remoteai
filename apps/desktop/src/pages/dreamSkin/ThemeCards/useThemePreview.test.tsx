// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { loadDreamSkinThemePreview } from '../../../api/backend';
import { themeThumbnails } from './themeThumbnails';
import { useThemePreview } from './useThemePreview';

vi.mock('../../../api/backend', () => ({ loadDreamSkinThemePreview: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

it('loads only nearby thumbnails, releases offscreen references, and can reload on re-entry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let visibility: (visible: boolean) => void = () => {};
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      visibility = visible => callback([{ isIntersecting: visible } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver);
    }
    observe() {} disconnect() {}
  });
  vi.mocked(loadDreamSkinThemePreview).mockResolvedValue('data:image/png;base64,small');
  const host = document.createElement('div');
  const root = createRoot(host);
  const release = themeThumbnails.retain();
  function Card({ id }: { id: string }) {
    const { cardRef, resolvedPreview } = useThemePreview({ id, previewEnabled: true });
    return <article ref={cardRef} data-preview={resolvedPreview ?? ''} />;
  }
  try {
    await act(async () => root.render(<Card id="first" />));
    expect(loadDreamSkinThemePreview).not.toHaveBeenCalled();
    await act(async () => visibility(true));
    expect(loadDreamSkinThemePreview).toHaveBeenCalledWith('first', true);
    expect(host.firstElementChild?.getAttribute('data-preview')).toContain('small');
    await act(async () => visibility(false));
    expect(host.firstElementChild?.getAttribute('data-preview')).toBe('');
    await act(async () => visibility(true));
    expect(host.firstElementChild?.getAttribute('data-preview')).toContain('small');
    await act(async () => root.render(<Card id="second" />));
    expect(loadDreamSkinThemePreview).toHaveBeenCalledWith('second', true);
  } finally { await act(async () => root.unmount()); release(); }
});
