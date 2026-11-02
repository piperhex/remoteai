import { checkPreviewSize, filePreviewKind, PREVIEW_BYTE_LIMIT, type PreviewLoader } from './kinds';
import { loadHtmlAsset } from './htmlAssetLoad';
import { deferCssImage, deferHtmlMedia, type HtmlMediaAsset } from './htmlMedia';
import { prepareHtmlImageLinks } from './htmlImageLinks';

const MAX_ASSETS = 256;
const EMPTY_ASSET = 'data:,';
type ResolveAsset = (source: string, base: string, ancestors?: readonly string[]) => Promise<string>;

/** Use file URL resolution without ever sending a local path to the browser's HTTP origin. */
export function htmlFileUrl(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const encoded = normalized.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')
    .replace(/^([a-z])%3A\//i, '$1:/');
  return new URL(`file:///${encoded}`);
}

function localReference(source: string, base: string) {
  if (!source.trim() || source.startsWith('#')) return undefined;
  const url = /^[a-z]:[\\/]/i.test(source) ? htmlFileUrl(source) : new URL(source.replace(/\\/g, '/'), base);
  if (url.protocol !== 'file:') return undefined;
  if (url.hostname) throw new Error('Unsupported file host');
  const path = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, '$1');
  if (/[\x00-\x1f]/.test(path)) throw new Error('Invalid file path');
  return { path, url: url.href, hash: url.hash };
}

function dataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Rewrite both url() and quoted @import, resolving each stylesheet against its own directory. */
async function rewriteCss(css: string, base: string, resolve: ResolveAsset) {
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gi;
  let result = '', previous = 0;
  for (const match of css.matchAll(pattern)) {
    const source = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    const url = await resolve(source.trim(), base);
    result += css.slice(previous, match.index) + (match[0].startsWith('@') ? '@import ' : '')
      + (url.startsWith('var(--preview-') ? url : `url(${JSON.stringify(url)})`);
    previous = match.index! + match[0].length;
  }
  return result + css.slice(previous);
}

async function rewriteSrcset(value: string, base: string, resolve: ResolveAsset) {
  // A data URL may contain commas; candidates are separated after their optional descriptor.
  const pattern = /\s*(\S+)(?:\s+([^,]+))?\s*(?:,|$)/g;
  const candidates: string[] = [];
  for (const match of value.matchAll(pattern)) {
    const source = match[1].replace(/,+$/, '');
    candidates.push(`${await resolve(source, base)}${match[2] ? ` ${match[2].trim()}` : ''}`);
  }
  return candidates.join(', ');
}

async function rewriteDocument(document: Document, base: string,
  { resolve, resolveCss }: { resolve: ResolveAsset; resolveCss: ResolveAsset }) {
  for (const element of document.querySelectorAll('[src], [poster], [srcset], [style], link[href], style')) {
    for (const name of ['src', 'poster']) {
      if (element.hasAttribute(name)) element.setAttribute(name, await resolve(element.getAttribute(name)!, base));
    }
    if (element.hasAttribute('srcset')) {
      element.setAttribute('srcset', await rewriteSrcset(element.getAttribute('srcset')!, base, resolve));
    }
    if (element.matches('link[rel~="stylesheet"]')) {
      const url = await resolve(element.getAttribute('href')!, base);
      if (url.startsWith('data:text/css;base64,')) {
        const style = document.createElement('style');
        style.textContent = new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1]), char => char.charCodeAt(0)));
        if (element.hasAttribute('media')) style.setAttribute('media', element.getAttribute('media')!);
        element.replaceWith(style);
      } else element.setAttribute('href', url);
    }
    if (element.hasAttribute('style')) {
      element.setAttribute('style', await rewriteCss(element.getAttribute('style')!, base, resolveCss));
    }
    if (element.tagName === 'STYLE') element.textContent = await rewriteCss(element.textContent ?? '', base, resolveCss);
  }
}

interface DeferredAssets { assets: HtmlMediaAsset[]; channel?: string }

function cssAssetResolver(resolve: ResolveAsset, deferred: DeferredAssets): ResolveAsset {
  return async (source, base, ancestors) => {
    if (!deferred.channel) return resolve(source, base, ancestors);
    try {
      const reference = localReference(source, base);
      if (reference && filePreviewKind(reference.path) === 'image') {
        return deferCssImage({ assets: deferred.assets, channel: deferred.channel,
          read: () => resolve(source, base, ancestors) });
      }
    } catch { /* The normal resolver records invalid references as failed assets. */ }
    return resolve(source, base, ancestors);
  };
}

function createAssetResolver(load: PreviewLoader, signal: AbortSignal, deferred: DeferredAssets) {
  const cache = new Map<string, Promise<string>>();
  let bytes = 0, failed = false;
  const resolve: ResolveAsset = async (source, base, ancestors = []) => {
    signal.throwIfAborted();
    try {
      const reference = localReference(source, base);
      if (!reference) return !source.trim() || source.startsWith('#') ? source : new URL(source, base).href;
      if (ancestors.includes(reference.path)) return EMPTY_ASSET;
      if (!cache.has(reference.path)) {
        if (cache.size >= MAX_ASSETS) throw new Error('Too many preview assets');
        cache.set(reference.path, readAsset(reference, ancestors));
      }
      return await cache.get(reference.path)! + reference.hash;
    } catch (error) {
      if (signal.aborted) throw error;
      failed = true;
      return EMPTY_ASSET;
    }
  };
  const resolveCss = cssAssetResolver(resolve, deferred);
  async function readAsset(reference: { path: string; url: string }, ancestors: readonly string[]) {
    const file = await loadHtmlAsset({ load, path: reference.path, signal });
    signal.throwIfAborted();
    checkPreviewSize(file.size);
    bytes += file.size;
    if (bytes > PREVIEW_BYTE_LIMIT) throw new Error('Preview assets exceed memory limit');
    if (/\.css$/i.test(reference.path)) {
      const css = await rewriteCss(await file.text(), reference.url,
        (source, base) => resolveCss(source, base, [...ancestors, reference.path]));
      return dataUrl(new Blob([css], { type: 'text/css' }));
    }
    const script = /\.[cm]?js$/i.test(reference.path);
    return dataUrl(script ? new Blob([file], { type: 'text/javascript' }) : file);
  }
  return { resolve, resolveCss, failed: () => failed };
}

/** Package static dependencies through the selected computer's existing authenticated file reader.
 * The iframe keeps an opaque origin: never grant allow-same-origin to make resources work.
 */
export async function prepareHtmlPreview(options: {
  text: string; path: string; load: PreviewLoader; signal: AbortSignal; mediaChannel?: string;
  mediaReceiverUrl?: string;
}) {
  const { signal } = options;
  const media: HtmlMediaAsset[] = [];
  const assets = createAssetResolver(options.load, signal, { assets: media, channel: options.mediaChannel });
  const document = new DOMParser().parseFromString(options.text, 'text/html');
  const fileUrl = htmlFileUrl(options.path);
  const base = new URL(document.querySelector('base[href]')?.getAttribute('href') ?? '', fileUrl).href;
  // A file base is useful to the resolver, but not loadable in a browser iframe.
  document.querySelectorAll('base').forEach(element => element.remove());
  const imageLinks = prepareHtmlImageLinks(document, source => localReference(source, base));
  if (options.mediaChannel) deferHtmlMedia({ document, base, assets: media,
    resolve: (source, base, attribute) => attribute === 'srcset'
      ? rewriteSrcset(source, base, assets.resolve) : assets.resolve(source, base),
    channel: options.mediaChannel, receiverUrl: options.mediaReceiverUrl ?? '' });
  await rewriteDocument(document, base, assets);
  signal.throwIfAborted();
  return { html: '<!doctype html>\n' + document.documentElement.outerHTML, failed: assets.failed(),
    media, imageLinks, hasFailed: assets.failed };
}
