import { readFileSync } from 'node:fs';

export function samplePdf(paddingBytes = 0) {
  const streams = ['PDF preview first page', 'PDF preview second page'].map(text =>
    `BT /F1 24 Tf 50 730 Td (${text}) Tj ET`);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map(stream => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
  ];
  if (paddingBytes) {
    objects.push(`<< /Length ${paddingBytes} >>\nstream\n${'\0'.repeat(paddingBytes)}\nendstream`);
  }
  return pdfFixture(objects);
}

export function pdfFixture(objects: readonly string[]) {
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}

function sampleWav() {
  const sampleRate = 8000;
  const dataLength = sampleRate * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + dataLength, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

export function previewSamples() {
  return {
    'report.PDF': samplePdf(), 'broken.pdf': Buffer.from('broken pdf'),
    'guide.md': Buffer.from('# Preview heading\n\n**Formatted document**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
      + '\n\n![Document image](image.svg)\n\n[Open PDF](report.PDF)'),
    'page.html': Buffer.from('<link rel="stylesheet" href="page.css"><h1>HTML preview</h1>'
      + '<a href="image.svg" target="_blank"><img alt="HTML asset" src="image.svg"></a>'
      + '<script>parent.document.body.dataset.escaped="yes"</script>'),
    'page.css': Buffer.from('h1{color:rgb(17,119,85)}'),
    'image.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'
      + '<rect width="200" height="100" fill="#14806f"/></svg>'),
    'sound.wav': sampleWav(),
    'video.mp4': readFileSync(new URL('./fixtures/video-preview.mp4', import.meta.url)),
  };
}
