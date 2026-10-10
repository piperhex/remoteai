import { test, expect } from "@playwright/test";

test("application artwork appears in the shortcut and the Open with submenu", async ({ page }) => {
  const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">'
    + '<path fill="#007acc" d="M0 0h16v16H0z"/></svg>';
  const icon = `data:image/svg+xml;base64,${Buffer.from(artwork).toString("base64")}`;
  await page.route("**/e2e/file-menu-icons.json", route => route.fulfill({ json: [
    { id: "vscode", name: "VS Code", kind: "editor", icon },
    { id: "terminal", name: "终端", kind: "terminal" },
  ] }));
  await page.goto("/e2e/file-menu-harness.html?icons=1");
  await page.getByRole("button", { name: "文件操作：C:/项目/季度报告.pdf" }).click();
  const shortcut = page.getByRole("menuitem", { name: "在 VS Code 中打开", exact: true }).locator("img");
  await expect(shortcut).toHaveAttribute("src", icon);
  await page.getByRole("menuitem", { name: "打开方式", exact: true }).hover();
  const editor = page.getByRole("menuitem", { name: "VS Code", exact: true });
  await expect(editor.locator("img")).toHaveAttribute("src", icon);
  await expect(page.getByRole("menuitem", { name: "终端", exact: true }).locator("svg")).toBeVisible();
  await editor.click();
  await expect(page.getByLabel("操作结果")).toContainText('"application":"vscode"');
});

test("copy file dispatches a native file action and confirms that it can be pasted", async ({ page }) => {
  await page.goto("/e2e/file-menu-harness.html");
  await page.getByRole("button", { name: "文件操作：C:/项目/季度报告.pdf" }).click();
  await page.getByRole("menuitem", { name: "复制文件", exact: true }).click();
  await expect(page.getByLabel("操作结果")).toContainText('"type":"copyFile"');
  await expect(page.getByText("文件已复制，可粘贴到文件夹。", { exact: true })).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("file links show an application submenu, preserve line numbers and close on Escape", async ({ page }) => {
  await page.goto("/e2e/file-menu-harness.html");
  const trigger = page.getByRole("button", { name: "文件操作：C:/项目/季度报告.pdf" });
  await trigger.click();
  await page.getByRole("menuitem", { name: "打开方式", exact: true }).hover();
  await expect(page.getByRole("menuitem", { name: "VS Code", exact: true })).toBeVisible();
  const menus = page.getByRole("menu");
  for (const menu of await menus.all()) expect((await menu.boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.screenshot({ path: "../../.codex-tmp/file-menu-desktop.png", animations: "disabled" });
  await page.getByRole("menuitem", { name: "VS Code", exact: true }).click();
  await expect(page.getByLabel("操作结果")).toContainText('"line":12');
  await expect(page.getByLabel("操作结果")).toContainText('"application":"vscode"');
  await trigger.focus(); await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("edited file links open diffs on left click and keep file actions on right click", async ({ page }) => {
  await page.goto("/e2e/file-menu-harness.html");
  const trigger = page.getByRole("button", { name: "查看 src/report.ts 的差异" });
  await trigger.click();
  await expect(page.getByLabel("操作结果")).toHaveText("差异：src/report.ts");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "打开文件", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "在 VS Code 中打开", exact: true }).click();
  await expect(page.getByLabel("操作结果")).toContainText('"application":"vscode"');
  await trigger.focus(); await page.keyboard.press("Enter");
  await expect(page.getByLabel("操作结果")).toHaveText("差异：src/report.ts");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click({ button: "right" });
  await page.getByRole("menuitem", { name: "查看差异", exact: true }).click();
  await expect(page.getByLabel("操作结果")).toHaveText("差异：src/report.ts");
});

test("the conversation stays responsive while applications are loading", async ({ page }) => {
  await page.goto("/e2e/file-menu-harness.html?delay=1500");
  await page.getByRole("button", { name: "文件操作：C:/项目/季度报告.pdf" }).click();
  const before = Number(await page.getByLabel("刷新次数").textContent());
  await page.getByLabel("消息").fill("继续处理");
  await expect(page.getByLabel("消息")).toHaveValue("继续处理");
  await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(before + 3);
});

test("the dark menu and submenu fit in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto("/e2e/file-menu-harness.html?dark=1");
  await page.getByRole("button", { name: "文件操作：C:/项目/季度报告.pdf" }).click();
  await page.getByRole("menuitem", { name: "打开方式", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "其他应用…", exact: true })).toBeVisible();
  for (const menu of await page.getByRole("menu").all()) {
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: "../../.codex-tmp/file-menu-dark-narrow.png", animations: "disabled" });
});
