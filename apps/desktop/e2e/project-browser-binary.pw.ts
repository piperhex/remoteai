import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { editorService } from '../../../scripts/project-editor-harness/client.mjs';
import { samplePdf } from './preview-samples';

const executable = resolve('../../scripts/project-editor-harness/target/debug/project-editor-harness.exe');
const filename = 'large-report.pdf';

test.beforeAll(() => {
  execFileSync('cargo', ['build', '--manifest-path', '../../scripts/project-editor-harness/Cargo.toml'],
    { windowsHide: true, stdio: 'pipe' });
});

async function pdfService(page: Page) {
  const directory = mkdtempSync(test.info().outputPath('source-'));
  const path = process.env.PDF_PREVIEW_TEST_FILE ?? resolve(directory, filename);
  if (!process.env.PDF_PREVIEW_TEST_FILE) writeFileSync(path, samplePdf(4 * 1024 * 1024));
  const bytes = readFileSync(path);
  const service = editorService(executable);
  const documents: Record<string, unknown>[] = [];
  await page.exposeBinding('projectEditorService', async (_, input: Record<string, unknown>) => {
    const reply = await service.request({ ...input, cwd: dirname(path), path });
    if (reply.data && typeof reply.data === 'object') documents.push(reply.data);
    return reply.data && { ...reply.data, path: input.path };
  });
  return { bytes, documents, close: service.close };
}

async function expectRenderedPdf(page: Page) {
  const panel = page.locator('.pf-file-panel:visible');
  const number = await panel.locator('.file-pdf-pages').getAttribute('data-current-page');
  const canvas = panel.locator(`.file-pdf-page[data-pdf-page="${number}"] canvas`);
  await expect(canvas).toBeVisible();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.locator('.pf-window-navigation')).toHaveCount(0);
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    let ink = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 230) ink += 1;
    return ink;
  })).toBeGreaterThan(100);
  return panel;
}

for (const mode of ['local', 'remote', 'web']) {
  test(`${mode}: a large PDF bypasses text paging with the production file service`, async ({ page }, info) => {
    const service = await pdfService(page);
    try {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`/e2e/project-browser-harness.html?mode=${mode}&editorService=1`);
      await page.getByRole('button', { name: '文件浏览', exact: true }).waitFor();
      await page.evaluate(({ name, data }) => {
        (window as unknown as { setPreviewFiles: (files: Record<string, string>) => void })
          .setPreviewFiles({ [name]: data });
      }, { name: filename, data: service.bytes.toString('base64') });
      await page.getByRole('button', { name: '文件浏览', exact: true }).click();
      await page.getByRole('treeitem', { name: filename, exact: true }).click();
      const panel = await expectRenderedPdf(page);
      expect(service.documents).toHaveLength(1);
      expect(service.documents[0]).toMatchObject({ kind: 'binary', size: service.bytes.length,
        readOnly: true, chunked: false, text: null });
      expect(service.documents[0]).not.toHaveProperty('window');
      await page.screenshot({ path: info.outputPath(`${mode}-large-pdf-first-page.png`) });
      await panel.getByRole('button', { name: '下一页', exact: true }).click();
      await expect(panel.locator('.file-pdf-toolbar [role="status"]')).toHaveText(/^2 \/ /);
      await page.setViewportSize({ width: 900, height: 800 });
      await expectRenderedPdf(page);
      await page.screenshot({ path: info.outputPath(`${mode}-large-pdf-narrow-second-page.png`) });
      if (process.env.PDF_PREVIEW_TEST_FILE) {
        const toggle = panel.getByRole('button', { name: 'PDF 导航', exact: true });
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await panel.getByRole('button', { name: '目录大纲', exact: true }).click();
        await expect(panel.locator('.file-pdf-outline button').first()).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${mode}-large-pdf-outline.png`) });
      }
    } finally { service.close(); }
  });
}
