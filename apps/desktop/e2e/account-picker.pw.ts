import { test, expect, type Page } from "@playwright/test";
import type { GuiAutoSwitchSettings } from "../../../shared/conversation/autoSwitchSettings";

const defaults: GuiAutoSwitchSettings = { enabled: false, switchOnQuotaExhaustion: true,
  minimumRemainingPercent: 0, mode: "sequential", fallbackProviderId: null, accounts: [] };
const triggerFor = (page: Page) => page.getByRole("button", { name: "切换 GUI 账户：workspace1@example.com" });

async function mockCommands(page: Page) {
  let saved: GuiAutoSwitchSettings | null = null;
  await page.route("**/__codex_switch__/api/invoke", async (route) => {
    const { command, args } = route.request().postDataJSON();
    if (command === "codex_gui_set_auto_switch_settings") saved = args.settings;
    const result = command === "codex_gui_auto_switch_settings" ? saved ?? defaults
      : command === "codex_gui_set_auto_switch_settings" ? saved : { running: true };
    await route.fulfill({ json: { ok: true, result } });
  });
  return () => saved;
}

async function expectAligned(page: Page) {
  const trigger = triggerFor(page);
  const popup = page.locator(".ant-popover:visible");
  await expect(popup).toBeVisible();
  await expect.poll(async () => {
    const target = (await trigger.boundingBox())!;
    const panel = (await popup.boundingBox())!;
    return Math.abs(target.x - panel.x);
  }).toBeLessThan(1);
  const bounds = (await popup.boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(280);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function chooseSetting(page: Page, label: string, value: string) {
  const select = page.locator(".ant-select").filter({ has: page.getByRole("combobox", { name: label, exact: true }) });
  await select.locator(".ant-select-selector").click();
  await page.locator(".ant-select-dropdown:visible").getByText(value, { exact: true }).click();
}

test("appearance changes messages, composer and code immediately and survives reload", async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  await mockCommands(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/account-picker-harness.html?fontSample");
  const openAppearance = async () => {
    await triggerFor(page).click();
    await page.getByRole("button", { name: "Codex GUI 设置", exact: true }).click();
    await page.getByRole("tab", { name: "界面", exact: true }).click();
  };
  await openAppearance();
  await page.getByRole("spinbutton", { name: "字体大小", exact: true }).fill("24");
  await page.getByRole("spinbutton", { name: "字体大小", exact: true }).blur();
  const sample = page.getByRole("region", { name: "对话字号示例" });
  await expect(sample.getByText("这是一条回复。", { exact: true })).toHaveCSS("font-size", "24px");
  await expect(sample.getByText("你好，Codex。", { exact: true })).toHaveCSS("font-size", "24px");
  await expect(sample.getByRole("textbox")).toHaveCSS("font-size", "24px");
  await expect(sample.locator("pre code")).toHaveCSS("font-size", "22px");
  await page.screenshot({ path: "../../.codex-tmp/gui-appearance-desktop.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.getByRole("tabpanel", { name: "界面", exact: true });
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "恢复默认" })).toBeInViewport();
  await expect(page.getByRole("button", { name: /^完\s*成$/ })).toBeInViewport();
  await page.screenshot({ path: "../../.codex-tmp/gui-appearance-narrow.png", animations: "disabled" });
  await page.reload();
  await expect(sample.getByRole("textbox")).toHaveCSS("font-size", "24px");
  await openAppearance();
  await page.getByRole("button", { name: "恢复默认" }).click();
  await expect(sample.getByRole("textbox")).toHaveCSS("font-size", "14px");
});

test("compact picker aligns with the footer across sidebar and viewport resizing", async ({ page }) => {
  await mockCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/e2e/account-picker-harness.html");
  await expect(triggerFor(page).locator('svg')).toHaveCount(0);
  expect((await triggerFor(page).boundingBox())!.height).toBeLessThan(64);
  await triggerFor(page).click();
  await expectAligned(page);
  await page.screenshot({ path: "../../.codex-tmp/gui-account-picker-desktop.png", animations: "disabled" });
  await page.getByLabel("会话侧栏").evaluate((element) => {
    (element as HTMLElement).style.setProperty("--fixture-sidebar-width", "286px");
  });
  await expectAligned(page);
  await page.getByLabel("会话侧栏").evaluate((element) => {
    (element as HTMLElement).style.removeProperty("--fixture-sidebar-width");
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expectAligned(page);
  await page.screenshot({ path: "../../.codex-tmp/gui-account-picker-narrow.png", animations: "disabled" });
});

test("gear opens responsive settings with aligned accounts and saves GUI settings", async ({ page }) => {
  const saved = await mockCommands(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/account-picker-harness.html");
  await triggerFor(page).click();
  await page.getByRole("button", { name: "Codex GUI 设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Codex GUI 设置" });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeCloseTo(1240, 0);
  // The opening transform changes cell coordinates until the dialog settles.
  await dialog.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const rows = dialog.locator("tbody tr");
  const firstCells = await rows.first().locator("td").all();
  const reference = await Promise.all(firstCells.map(async (cell) => (await cell.boundingBox())!));
  for (const row of await rows.all()) {
    const cells = await row.locator("td").all();
    for (const [index, cell] of cells.entries()) {
      const bounds = (await cell.boundingBox())!;
      expect(bounds.x).toBeCloseTo(reference[index].x, 0);
      expect(Math.abs(bounds.height - reference[index].height)).toBeLessThanOrEqual(1);
    }
  }
  await page.screenshot({ path: "../../.codex-tmp/gui-auto-switch-settings-desktop.png", animations: "disabled" });
  await expect(page.getByRole("switch", { name: "自动切换账号", exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("spinbutton", { name: "默认剩余额度阈值", exact: true })).toBeDisabled();
  await page.getByRole("switch", { name: "自动切换账号", exact: true }).click();
  await page.getByRole("spinbutton", { name: "默认剩余额度阈值", exact: true }).fill("12.5");
  await chooseSetting(page, "分配方式", "并发分配");
  await chooseSetting(page, "备用 Provider", "备用服务");
  const priority = page.getByRole("spinbutton", { name: "workspace1@example.com 优先级", exact: true });
  await expect(priority).toHaveValue("0");
  await priority.fill("-2");
  await page.getByRole("switch", { name: "workspace2@example.com 参与自动切换", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeCloseTo(390 - 24, 0);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  const beats = Number(await page.getByLabel("刷新次数").textContent());
  await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(beats + 3);
  await dialog.locator(".ant-modal-body").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: "../../.codex-tmp/gui-auto-switch-settings-narrow.png", animations: "disabled" });
  await page.getByRole("button", { name: /^保\s*存$/ }).click();
  await expect(dialog).not.toBeVisible();
  expect(saved()).toEqual({ ...defaults, enabled: true, minimumRemainingPercent: 12.5,
    mode: "concurrent", fallbackProviderId: "backup", accounts: [
      { accountId: "account-0", enabled: true, priority: -2, thresholdPercent: 0 },
      { accountId: "account-1", enabled: false, priority: 0, thresholdPercent: 0 },
    ] });
  await expect(triggerFor(page)).toBeFocused();
});

test("quota countdowns stay live while the account table scrolls inside a fixed dialog", async ({ page }) => {
  await mockCommands(page);
  await page.route("**/__codex_switch__/api/invoke", async (route) => {
    if (route.request().postDataJSON().command === "get_local_proxy_status") {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    await route.fallback();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/account-picker-harness.html?manyAccounts");
  await triggerFor(page).click();
  await page.getByRole("button", { name: "Codex GUI 设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Codex GUI 设置" });
  const table = dialog.getByRole("table");
  const scroll = table.locator("..");
  await expect(table.getByRole("columnheader", { name: "主用量" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "次用量" })).toBeVisible();
  const first = table.locator("tbody tr").first();
  await expect(first.getByRole("progressbar", { name: "主用量剩余" })).toHaveAttribute("aria-valuenow", "10");
  await expect(first.getByRole("progressbar", { name: "次用量剩余" })).toHaveAttribute("aria-valuenow", "75");
  const before = await first.locator("td").nth(2).textContent();
  await expect.poll(() => first.locator("td").nth(2).textContent()).not.toBe(before);
  await page.getByRole("switch", { name: "自动切换账号", exact: true }).click();
  await first.getByRole("spinbutton", { name: "workspace1@example.com 优先级", exact: true }).fill("3");
  const beats = Number(await page.getByLabel("刷新次数").textContent());
  await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(beats + 3);
  const headerTop = (await table.locator("thead").boundingBox())!.y;
  const save = dialog.getByRole("button", { name: /^保\s*存$/ });
  const footerTop = (await save.boundingBox())!.y;
  const bounds = (await scroll.boundingBox())!;
  expect(footerTop - bounds.y - bounds.height).toBeLessThan(30);
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(first).not.toBeInViewport();
  expect((await table.getByRole("columnheader").first().boundingBox())!.y).toBeCloseTo(headerTop, 0);
  expect((await save.boundingBox())!.y).toBeCloseTo(footerTop, 0);
  expect(await dialog.locator(".ant-modal-body").evaluate((element) => element.scrollHeight <= element.clientHeight))
    .toBe(true);
  await page.screenshot({ path: "../../.codex-tmp/gui-auto-switch-usage-scroll.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(save).toBeInViewport();
  await scroll.scrollIntoViewIfNeeded();
  await expect(scroll).toBeInViewport();
  await expect(save).toBeInViewport();
  expect(await scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: "../../.codex-tmp/gui-auto-switch-usage-narrow.png", animations: "disabled" });
});
