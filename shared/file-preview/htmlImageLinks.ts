import { filePreviewKind } from './kinds';

export interface HtmlImageLink { url: string; path: string; description: string }
const IMAGE_LINK_PREFIX = 'https://html-preview.invalid/image/';

/** Register document-declared images instead of allowing a preview to navigate to arbitrary device files. */
export function prepareHtmlImageLinks(document: Document, resolve: (source: string) => { path: string } | undefined) {
  const links: HtmlImageLink[] = [];
  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    let reference: { path: string } | undefined;
    try { reference = resolve(anchor.getAttribute('href')!); } catch { continue; }
    if (!reference || filePreviewKind(reference.path) !== 'image') continue;
    const url = `${IMAGE_LINK_PREFIX}${links.length}`;
    const description = anchor.querySelector('img')?.getAttribute('alt')?.trim()
      || reference.path.split(/[\\/]/).at(-1) || reference.path;
    links.push({ url, path: reference.path, description });
    anchor.setAttribute('href', url);
    anchor.setAttribute('data-preview-image-link', url);
    anchor.setAttribute('target', '_self');
    anchor.removeAttribute('download');
  }
  return links;
}

export function readHtmlImageLinks(value: unknown): HtmlImageLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item: unknown): item is HtmlImageLink => {
    if (!item || typeof item !== 'object') return false;
    const link = item as Record<string, unknown>;
    return typeof link.url === 'string' && link.url.startsWith(IMAGE_LINK_PREFIX)
      && typeof link.path === 'string' && filePreviewKind(link.path) === 'image'
      && typeof link.description === 'string';
  });
}

export function findHtmlImageLink(links: readonly HtmlImageLink[] | undefined, url: unknown) {
  return typeof url === 'string' ? links?.find(link => link.url === url) : undefined;
}
