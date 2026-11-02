import { useCallback, useEffect, useRef } from 'react';
import { ImageViewer } from '../chat/ImageViewer';
import { displayText } from '../localization/messages';
import type { PreviewImageLoader } from '../remote-chat/previewProgress';
import { checkPreviewSize, type PreviewLoader } from './kinds';
import { loadHtmlAsset } from './htmlAssetLoad';
import type { HtmlImageLink } from './htmlImageLinks';
import { HTML_IMAGE_PLACEHOLDER } from './htmlPlaceholder';

export function HtmlImagePreview({ link, load, close }: {
  link: HtmlImageLink; load: PreviewLoader; close: () => void;
}) {
  const urls = useRef(new Set<string>());
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const original = useCallback<PreviewImageLoader>(async options => {
    const signal = options?.signal ?? new AbortController().signal;
    const file = await loadHtmlAsset({ load, path: link.path, signal });
    signal.throwIfAborted();
    checkPreviewSize(file.size);
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    return url;
  }, [link.path, load]);
  return <ImageViewer thumbnail={HTML_IMAGE_PLACEHOLDER} description={link.description} load={original}
    close={close} translate={displayText} autoLoadOriginal />;
}
