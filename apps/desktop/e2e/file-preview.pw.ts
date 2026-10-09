import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

for (const width of [540, 1440]) {
  test(`preview history goes back, forward and starts a new branch at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/e2e/file-preview-harness.html");
    const back = page.getByRole("button", { name: "返回上一页", exact: true });
    const forward = page.getByRole("button", { name: "前往下一页", exact: true });
    const markdown = page.getByRole("heading", { name: "项目说明" });
    await expect(back).toBeDisabled(); await expect(forward).toBeDisabled();
    await page.getByRole("button", { name: "预览文件：C:/project/docs/settings.yaml" }).click();
    await expect(page.getByLabel("文件内容", { exact: true })).toContainText("name: preview");
    await back.click(); await expect(markdown).toBeVisible();
    await expect(back).toBeDisabled(); await expect(forward).toBeEnabled();
    await page.screenshot({ path: `../../.codex-tmp/preview-history-${width}.png` });
    await forward.click();
    await expect(page.getByLabel("文件内容", { exact: true })).toContainText("name: preview");
    await expect(forward).toBeDisabled();
    await back.click();
    await page.getByRole("button", { name: "预览文件：C:/project/docs/LICENSE" }).click();
    await expect(page.getByLabel("文件内容", { exact: true })).toContainText("Apache License");
    await expect(forward).toBeDisabled();
    await back.click(); await expect(markdown).toBeVisible();
    await forward.click();
    await expect(page.getByLabel("文件内容", { exact: true })).toContainText("Apache License");
    const sidebar = await page.getByRole("complementary").boundingBox();
    const bounds = await back.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(sidebar!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  });
}

test("renders Markdown with relative assets and keeps original actions in the top right", async ({ page }) => {
  await page.goto("/e2e/file-preview-harness.html");
  await expect(page.getByRole("heading", { name: "项目说明" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("img", { name: "示例图" })).toBeVisible();
  await expect(page.locator(".katex")).toBeVisible();
  await page.getByRole("button", { name: "预览文件：C:/project/docs/settings.yaml" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-opened", /"line":2/);
  await expect(page.getByLabel("文件内容", { exact: true })).toContainText("name: preview");
  await page.getByRole("button", { name: "预览文件：C:/project/docs/项目说明.md", exact: true }).click();
  await page.getByRole("button", { name: "文件操作：C:/project/docs/项目说明.md" }).click();
  await expect(page.getByRole("menuitem", { name: "另存为…", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "在 VS Code 中打开", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-action", /"application":"vscode"/);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.getByLabel("文件内容", { exact: true })).toContainText("# 项目说明");
  await page.screenshot({ path: "../../.codex-tmp/file-preview-markdown.png" });
});

test("HTML loads neighboring styles and scripts in an isolated frame and offers source", async ({ page }) => {
  await page.goto("/e2e/file-preview-harness.html?kind=html");
  const frame = page.frameLocator('iframe[title="HTML 预览"]');
  await expect(frame.getByRole("heading")).toHaveCSS("color", "rgb(17, 119, 85)");
  await expect(frame.locator("body")).toHaveAttribute("data-isolated", "yes");
  await expect(page.locator("body")).not.toHaveAttribute("data-leaked");
  await frame.getByRole("button", { name: "试一试" }).click();
  await expect(frame.getByRole("button", { name: "已点击" })).toBeVisible();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.getByLabel("文件内容").locator(".hljs-tag").first()).toBeVisible();
});

for (const language of ["yaml", "rs", "ps1", "py", "swift", "dockerfile", "ts"]) {
  test(`highlights ${language} with its language grammar`, async ({ page }) => {
    await page.goto(`/e2e/file-preview-harness.html?kind=${language}`);
    await expect(page.getByLabel("文件内容").locator('span[class*="hljs-"]').first()).toBeVisible();
    await expect(page.getByRole("button", { name: "复制文件内容", exact: true })).toBeVisible();
  });
}

test("videos play, pause and seek using browser controls", async ({ page }) => {
  await page.goto("/e2e/file-preview-harness.html?kind=video");
  const video = page.locator("video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => { element.muted = true; return element.play(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = element.duration / 2; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await page.getByRole("tab", { name: "文件更改" }).click();
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  await page.screenshot({ path: "../../.codex-tmp/file-preview-video.png" });
});

test("unsupported codecs keep the file menu available", async ({ page }) => {
  await page.goto("/e2e/file-preview-harness.html?kind=badVideo");
  await expect(page.getByRole("status")).toContainText("选择其他打开方式");
  await page.getByRole("button", { name: /文件操作：/ }).click();
  await expect(page.getByRole("menuitem", { name: "打开文件", exact: true })).toBeVisible();
});

test("large highlighted files keep the menu responsive and navigate to the referenced line", async ({ page }) => {
  await page.goto("/e2e/file-preview-harness.html?kind=large&dark=1");
  const content = page.getByLabel("文件内容", { exact: true });
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(1000);
  await page.getByRole("button", { name: /文件操作：/ }).click();
  await expect(page.getByRole("menuitem", { name: "打开文件", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "../../.codex-tmp/file-preview-code-dark.png" });
});

test("image sizing and the file menu fit a narrow preview window", async ({ page }) => {
  await page.setViewportSize({ width: 540, height: 700 });
  await page.goto("/e2e/file-preview-harness.html?kind=image&dark=1");
  await expect(page.getByRole("img", { name: "预览.svg" })).toBeVisible();
  await page.getByRole("button", { name: "原始大小" }).click();
  await page.getByRole("button", { name: "适应窗口" }).click();
  await page.getByRole("button", { name: /文件操作：/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: "../../.codex-tmp/file-preview-image-dark.png" });
});

test("file previews share the changes sidebar, resize, restore, and close without a popup", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/file-preview-harness.html");
  const sidebar = page.getByRole("complementary", { name: "预览详情" });
  await expect(sidebar).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  const content = page.getByRole("heading", { name: "项目说明" });
  const before = (await sidebar.boundingBox())!;
  const grip = page.getByRole("separator", { name: "调整详情抽屉宽度" });
  await grip.focus(); await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(before.width);
  await page.getByRole("button", { name: "查看文件更改" }).click();
  await expect(page.getByText("暂无文件更改", { exact: true })).toBeVisible();
  await expect(content).toBeHidden();
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  await expect(content).toBeVisible();
  await page.getByRole("button", { name: "最小化详情抽屉" }).click();
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "恢复预览" }).click();
  await expect(content).toBeVisible();
  await page.getByRole("button", { name: "展开详情抽屉" }).click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(1440);
  await page.getByRole("button", { name: "还原抽屉宽度" }).click();
  await page.screenshot({ path: "../../.codex-tmp/file-preview-sidebar.png" });
  await page.getByRole("button", { name: "关闭详情抽屉" }).click();
  await expect(sidebar).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute("data-closed", /.+/);
});

test("web links use the same sidebar with explicit browser and reload actions", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/file-preview-harness.html?kind=website");
  await page.getByRole("link", { name: "查看网页" }).click();
  const sidebar = page.getByRole("complementary", { name: "预览详情" });
  await expect(sidebar).toBeVisible();
  const frame = page.frameLocator('iframe[title="网页预览"]');
  await expect(frame.getByRole("heading", { name: "HTML 预览" })).toBeVisible();
  await frame.getByRole("button", { name: "试一试" }).click();
  await expect(frame.getByRole("button", { name: "已点击" })).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await expect(page.getByRole("button", { name: "在浏览器中打开" })).toBeVisible();
  await page.getByRole("button", { name: "重新加载网页" }).click();
  await expect(frame.getByRole("button", { name: "试一试" })).toBeVisible();
  await page.getByRole("tab", { name: "文件更改" }).click();
  await expect(page.getByText("暂无文件更改", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  await page.getByRole("button", { name: "切换主机：本地" }).click();
  await expect(page.getByRole("menu", { name: "主机列表" })).toBeVisible();
  await page.getByRole("textbox", { name: "搜索主机" }).press("Escape");
  await expect(page.getByRole("menu", { name: "主机列表" })).toBeHidden();
  await page.getByRole("button", { name: "选择电脑", exact: true }).click();
  await page.getByRole("dialog", { name: "选择电脑" }).getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("dialog", { name: "选择电脑" })).toBeHidden();
  await page.getByRole("button", { name: "立即发送", exact: true }).click();
  await expect(page.getByLabel("操作结果")).toHaveText("queueSendNow");
  await page.getByRole("button", { name: "编辑待发送消息" }).click();
  await expect(page.getByLabel("操作结果")).toHaveText("edited");
  await page.screenshot({ path: "../../.codex-tmp/website-preview-sidebar.png" });
  await page.getByRole("button", { name: "关闭详情抽屉" }).click();
  await expect(sidebar).toHaveCount(0);
});
