import { HTML_IMAGE_PLACEHOLDER } from './htmlPlaceholder';
type ResolveAsset = (source: string, base: string, attribute: string) => Promise<string>;
const MEDIA_WORKERS = 3;
export interface HtmlMediaAsset { id: string; attribute: string; read: () => Promise<string> }
export interface HtmlMediaUpdate { channel: string; id: string; attribute: string; value: string }

/** CSS variables update individual image references without replacing styles edited by page scripts. */
export function deferCssImage(options: {
  assets: HtmlMediaAsset[]; channel: string; read: () => Promise<string>;
}) {
  const id = String(options.assets.length);
  options.assets.push({ id, attribute: 'css', read: options.read });
  return `var(--preview-${options.channel}-${id}, url("data:,"))`;
}

/** Media loads after the document is visible, without replacing its DOM or resetting its scripts. */
export function deferHtmlMedia(options: {
  document: Document; base: string; resolve: ResolveAsset; channel: string; assets: HtmlMediaAsset[];
  receiverUrl: string;
}) {
  const { document, base, resolve, channel, assets } = options;
  for (const element of document.querySelectorAll('img, video, audio, source, track')) {
    for (const attribute of ['src', 'poster', 'srcset']) {
      const source = element.getAttribute(attribute);
      if (!source) continue;
      const id = String(assets.length);
      element.setAttribute(`data-preview-${attribute}`, id);
      element.removeAttribute(attribute);
      assets.push({ id, attribute, read: () => resolve(source, base, attribute) });
    }
    if (element.tagName === 'IMG' && (element.hasAttribute('data-preview-src')
      || element.hasAttribute('data-preview-srcset'))) {
      element.setAttribute('src', HTML_IMAGE_PLACEHOLDER);
      element.setAttribute('data-preview-placeholder', HTML_IMAGE_PLACEHOLDER);
      element.setAttribute('aria-busy', 'true');
    }
  }
  const script = document.createElement('script');
  // A same-origin external script also works under the desktop's strict script policy.
  script.src = options.receiverUrl;
  script.dataset.channel = channel;
  document.head.prepend(script);
  return assets;
}

/** Bound transfer concurrency so one slow video cannot hold up every other image. */
export async function loadHtmlMedia(options: {
  assets: HtmlMediaAsset[]; signal: AbortSignal; update: (asset: HtmlMediaAsset, value: string) => void;
}) {
  const pending = [...options.assets];
  const worker = async () => {
    while (!options.signal.aborted) {
      const asset = pending.shift();
      if (!asset) return;
      const value = await asset.read();
      if (!options.signal.aborted) options.update(asset, value);
    }
  };
  await Promise.all(Array.from({ length: MEDIA_WORKERS }, worker));
}
