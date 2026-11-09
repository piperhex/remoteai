import { expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfPageAt, pdfPageLayout, pdfScrollAnchor, visiblePdfPages } from '../../../../shared/file-preview/pdfLayout';
import { pdfDestinationPage, pdfOutlineDestination } from '../../../../shared/file-preview/pdfOutline';

const sizes = [{ width: 600, height: 800 }, { width: 800, height: 600 }, { width: 600, height: 800 }];

it('keeps portrait and landscape pages in one continuous layout at a common scale', () => {
  const pages = pdfPageLayout(sizes, 832, 1);
  expect(pages).toEqual([
    { width: 600, height: 800, top: 16 }, { width: 800, height: 600, top: 832 },
    { width: 600, height: 800, top: 1448 },
  ]);
  expect(pdfPageAt(pages, 0)).toBe(0);
  expect(pdfPageAt(pages, 832)).toBe(1);
  expect(pdfPageAt(pages, Number.MAX_SAFE_INTEGER)).toBe(2);
});

it('honors bookmark coordinates inside a page instead of always jumping to its top', async () => {
  const getPage = vi.fn(async () => ({ getViewport: () => ({ height: 800,
    convertToViewportPoint: (_x: number, y: number) => [0, 800 - y] }) }));
  const document = { numPages: 10, getPage } as unknown as PDFDocumentProxy;
  expect(await pdfOutlineDestination(document, [1, { name: 'XYZ' }, 0, 600, null]))
    .toEqual({ page: 2, position: .25 });
  expect(await pdfOutlineDestination(document, [1, { name: 'FitH' }, 400]))
    .toEqual({ page: 2, position: .5 });
  expect(await pdfOutlineDestination(document, [1, { name: 'Fit' }])).toEqual({ page: 2 });
});

it('follows the most visible page while rendering only its nearby pages', () => {
  const pages = pdfPageLayout(Array.from({ length: 1000 }, () => sizes[0]), 632, 1);
  expect(visiblePdfPages(pages, pages[500].top + 100, 700)).toEqual({ first: 499, last: 501, current: 500 });
  expect(visiblePdfPages(pages, pages[500].top + 700, 700).current).toBe(501);
  expect(visiblePdfPages([], 0, 700)).toEqual({ first: 0, last: 0, current: 0 });
});

it('preserves a reading position across zoom, sidebar changes and mixed page sizes', () => {
  const previous = pdfPageLayout(sizes, 832, 1);
  const next = pdfPageLayout(sizes, 632, 2);
  const top = pdfScrollAnchor({ previous, next, top: previous[1].top + previous[1].height * .3 });
  expect(top).toBeCloseTo(next[1].top + next[1].height * .3);
  expect(pdfScrollAnchor({ previous: [], next, top: 200 })).toBe(0);
});

it('resolves named, indexed and indirect bookmarks without following external links', async () => {
  const getDestination = vi.fn(async () => [{ num: 12, gen: 0 }, { name: 'Fit' }]);
  const getPageIndex = vi.fn(async () => 6);
  const document = { numPages: 10, getDestination, getPageIndex } as unknown as PDFDocumentProxy;
  expect(await pdfDestinationPage(document, 'chapter')).toBe(7);
  expect(await pdfDestinationPage(document, [0, { name: 'Fit' }])).toBe(1);
  for (const value of [null, [], [-1], [10], [1.5], ['https://example.com'], { url: 'javascript:alert(1)' }]) {
    expect(await pdfDestinationPage(document, value)).toBeUndefined();
  }
  expect(getPageIndex).toHaveBeenCalledExactlyOnceWith({ num: 12, gen: 0 });
});
