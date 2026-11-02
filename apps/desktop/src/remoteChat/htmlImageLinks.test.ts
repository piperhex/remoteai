// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { prepareHtmlPreview } from '../../../../shared/file-preview/htmlAssets';
import { findHtmlImageLink, readHtmlImageLinks } from '../../../../shared/file-preview/htmlImageLinks';
import type { PreviewLoader } from '../../../../shared/file-preview/kinds';

it('registers local image links using the document base without downloading originals before a click', async () => {
  const load = vi.fn<PreviewLoader>();
  const result = await prepareHtmlPreview({ path: 'F:/report/index.html', signal: new AbortController().signal, load,
    text: '<base href="assets/"><a href="../full%20image.png" target="_blank" download>Image</a>'
      + '<a href="nested/detail.svg">SVG</a><a href="#part">Section</a><a href="next.html">Next</a>'
      + '<a href="https://example.com/image.png">Web image</a><a href="file://host/private.png">Unsafe</a>' });
  expect(result.imageLinks.map(link => link.path)).toEqual(['F:/report/full image.png', 'F:/report/assets/nested/detail.svg']);
  expect(result.html).toContain('target="_self"');
  expect(result.html).not.toContain(' download');
  expect(result.html).toContain('href="#part"');
  expect(load).not.toHaveBeenCalled();
  const link = result.imageLinks[0];
  expect(findHtmlImageLink(result.imageLinks, link.url)).toBe(link);
  for (const url of [undefined, 'file:///secret.png', `${link.url}?path=/secret.png`, `${link.url}/../1`]) {
    expect(findHtmlImageLink(result.imageLinks, url)).toBeUndefined();
  }
});

it('rejects malformed link manifests before they enter native navigation', () => {
  const link = { url: 'https://html-preview.invalid/image/0', path: '/image.png', description: 'Image' };
  expect(readHtmlImageLinks([null, {}, { ...link, path: 123 }, { ...link, path: '/script.js' }, link])).toEqual([link]);
  expect(readHtmlImageLinks({ links: [link] })).toEqual([]);
});
