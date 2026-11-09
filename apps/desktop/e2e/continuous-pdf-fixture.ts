import { pdfFixture } from './preview-samples';

export const PDF_FIXTURE_PAGES = 24;
const pageId = (page: number) => 4 + (page - 1) * 2;

export function continuousPdf() {
  const outline = pageId(PDF_FIXTURE_PAGES) + 2;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /Outlines ${outline} 0 R /Names << /Dests << /Names `
      + `[(methods) [${pageId(7)} 0 R /Fit]] >> >> >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: PDF_FIXTURE_PAGES }, (_, index) =>
      `${pageId(index + 1)} 0 R`).join(' ')}] /Count ${PDF_FIXTURE_PAGES} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let page = 1; page <= PDF_FIXTURE_PAGES; page += 1) {
    const [width, height] = page === 6 ? [792, 612] : [612, page === 13 ? 500 : 792];
    const stream = `BT /F1 24 Tf 50 ${height - 70} Td (Continuous PDF page ${page}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] `
      + `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId(page) + 1} 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push(
    `<< /Type /Outlines /First ${outline + 1} 0 R /Last ${outline + 4} 0 R /Count 3 >>`,
    `<< /Title (Introduction) /Parent ${outline} 0 R /Next ${outline + 2} 0 R /Dest [${pageId(1)} 0 R /Fit] >>`,
    `<< /Title (Methods) /Parent ${outline} 0 R /Prev ${outline + 1} 0 R /Next ${outline + 4} 0 R `
      + `/Dest (methods) /First ${outline + 3} 0 R /Last ${outline + 3} 0 R /Count -1 >>`,
    `<< /Title (Nested results) /Parent ${outline + 2} 0 R /Dest [${pageId(15)} 0 R /Fit] >>`,
    `<< /Title (External link) /Parent ${outline} 0 R /Prev ${outline + 2} 0 R `
      + '/A << /S /URI /URI (https://example.invalid/) >> >>',
  );
  return pdfFixture(objects);
}
