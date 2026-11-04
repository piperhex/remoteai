import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { FilePreviewData } from "../../../shared/file-preview/workspace/api";

const ASSET_PREFIX = "/__codex_switch__/file-preview/browser-session/";
const FILE_PATH = "C:/project/docs/report.md";
const DOCUMENT_POLICY = "sandbox allow-scripts; default-src 'self' data: blob: http: https:; "
  + "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http: https:; "
  + "style-src 'self' 'unsafe-inline' http: https:; frame-src 'none'; object-src 'none'; form-action 'none'";

async function setup(page: Page, kind: FilePreviewData["kind"]) {
  const closed: string[] = [];
  const files = { markdown: "readme.md", text: "settings.yaml", html: "preview-sample.html",
    image: "preview-sample.svg", video: "video-preview.mp4", audio: "sample.wav", pdf: "sample.pdf" };
  const text = kind === "markdown" ? "# 浏览器预览\n\n![相对图片](preview-sample.svg)\n\n[配置](settings.yaml#L2)"
    : "name: preview\nenabled: true\n";
  await page.addInitScript(() => sessionStorage.setItem("codex-switch:hosted-web-api-key", "test-lan-key"));
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route("**/__codex_switch__/api/invoke", async route => {
    const { command, args } = route.request().postDataJSON();
    expect(route.request().headers()["x-api-key"]).toBe("test-lan-key");
    expect(["codex_gui_open_file_preview", "codex_gui_close_file_preview"]).toContain(command);
    if (command === "codex_gui_close_file_preview") {
      closed.push(args.sessionId);
      await route.fulfill({ json: { ok: true, result: null } });
      return;
    }
    const nested = args.target.path.endsWith("settings.yaml");
    await route.fulfill({ json: { ok: true, result: {
      sessionId: "browser-session", path: args.target.path, name: nested ? "settings.yaml" : files[kind],
      kind: nested ? "text" : kind, line: args.target.line,
      text: nested ? "name: preview\nenabled: true\n" : text, url: ASSET_PREFIX + files[kind],
    } } });
  });
  await installAssetRoute(page);
  // Match the listener's policy; Vite also needs inline scripts for its development preamble.
  await page.route("**/hosted-file-preview-harness.html?*", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; "
      + "style-src 'self' 'unsafe-inline'; connect-src 'self' http: https: ws: wss:" } });
  });
  await page.goto(`/e2e/hosted-file-preview-harness.html?hosted&manual&path=${encodeURIComponent(FILE_PATH)}`);
  await page.getByRole("button", { name: `预览文件：${FILE_PATH}`, exact: true }).click();
  await expect(page.getByRole("region", { name: "文件预览" })).toBeVisible();
  return closed;
}

async function installAssetRoute(page: Page) {
  await page.route("**/__codex_switch__/file-preview/**", async route => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
      ...(/\.(html|svg)$/.test(name) ? { "Content-Security-Policy": DOCUMENT_POLICY } : {}) };
    if (name === "sample.wav") {
      await route.fulfill({ body: silentWave(), contentType: "audio/wav", headers });
      return;
    }
    if (name === "sample.pdf") {
      await route.fulfill({ body: samplePdf(), contentType: "application/pdf", headers });
      return;
    }
    const mime: Record<string, string> = { html: "text/html", svg: "image/svg+xml", css: "text/css", mp4: "video/mp4" };
    const body = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
    await route.fulfill({ body, contentType: mime[name.split(".").pop()!], headers });
  });
}

function silentWave() {
  const rate = 8000;
  const pcmBytes = rate * 2;
  const buffer = Buffer.alloc(44 + pcmBytes);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + pcmBytes, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(pcmBytes, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(pcmBytes, 40);
  return buffer;
}

function samplePdf() {
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of ["<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"]) {
    offsets.push(pdf.length);
    pdf += `${offsets.length - 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += "xref\n0 4\n0000000000 65535 f \n";
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return pdf + `trailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n${xref}\n%%EOF\n`;
}

test("hosted Markdown resolves images and nested files, and releases a closed preview", async ({ page }) => {
  const closed = await setup(page, "markdown");
  await expect(page.getByRole("heading", { name: "浏览器预览" })).toBeVisible();
  await expect.poll(() => page.getByRole("img", { name: "相对图片" })
    .evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "预览文件：C:/project/docs/settings.yaml" }).click();
  await expect(page.getByLabel("文件内容", { exact: true })).toContainText("name: preview");
  await page.getByRole("button", { name: "关闭详情抽屉" }).click();
  await expect.poll(() => closed.length).toBeGreaterThan(0);
});

test("hosted HTML loads adjacent styles and keeps scripts isolated", async ({ page }) => {
  await setup(page, "html");
  const frame = page.frameLocator('iframe[title="HTML 预览"]');
  await expect(frame.getByRole("heading")).toHaveCSS("color", "rgb(17, 119, 85)");
  await expect(frame.locator("body")).toHaveAttribute("data-isolated", "yes");
  await frame.getByRole("button", { name: "试一试" }).click();
  await expect(frame.getByRole("button", { name: "已点击" })).toBeVisible();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.getByLabel("文件内容", { exact: true })).toBeVisible();
});

for (const kind of ["text", "image", "video", "audio", "pdf"] as const) {
  test(`hosted ${kind} previews load under the listener content policy`, async ({ page }) => {
    const pdfResponse = kind === "pdf"
      ? page.waitForResponse(response => response.url().endsWith("/sample.pdf")) : null;
    await setup(page, kind);
    if (kind === "text") {
      await expect(page.getByLabel("文件内容", { exact: true })).toContainText("enabled: true");
    } else if (kind === "image") {
      await expect.poll(() => page.getByRole("img", { name: "preview-sample.svg" })
        .evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
    } else if (kind === "pdf") {
      await expect(page.locator('object[type="application/pdf"]')).toBeVisible();
      const response = await pdfResponse;
      expect(response?.status()).toBe(200);
      expect(response?.headers()["content-type"]).toBe("application/pdf");
    } else {
      const media = page.locator(kind);
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.readyState)).toBeGreaterThan(0);
      await media.evaluate((element: HTMLMediaElement) => { element.muted = true; return element.play(); });
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeGreaterThan(0);
    }
  });
}

test("hosted previews remain usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, "image");
  await expect(page.getByRole("button", { name: "适应窗口" })).toHaveCount(0);
  await page.getByRole("button", { name: "原始大小" }).click();
  await expect(page.getByRole("button", { name: "适应窗口" })).toBeVisible();
  await page.getByRole("button", { name: "关闭详情抽屉" }).click();
  await expect(page.getByRole("region", { name: "文件预览" })).toHaveCount(0);
});
