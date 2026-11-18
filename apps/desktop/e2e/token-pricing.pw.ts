import { expect, test } from "@playwright/test";
import bundled from "../src/data/tokenCostPresets.json" with { type: "json" };

const harness = "/e2e/token-pricing-harness.html";

async function saveAdminPresets(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "保存预设" }).click();
  await expect(page.getByText("已保存，用户下次启动 PC 端时生效。")).toBeVisible();
}

test("per-model Fast multipliers stay editable during a pending preset request", async ({ page }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname === "/token-cost-presets", async (route) => {
    await pending;
    await route.fulfill({ json: { ...bundled, models: [...bundled.models, {
      ...bundled.models[0], model: "admin-added-model", aliases: [], fastModeMultiplier: 3,
    }] } });
  });
  try {
    await page.goto(harness);
    await expect(page.getByRole("columnheader", { name: "快速模式成本倍率", exact: true })).toBeVisible();
    const sol = page.getByRole("spinbutton", { name: "gpt-6-sol 快速模式倍率", exact: true });
    const luna = page.getByRole("spinbutton", { name: "gpt-6-luna 快速模式倍率", exact: true });
    await expect(page.getByLabel("预估费用")).toHaveText("0.60");
    await sol.fill("3");
    await sol.blur();
    await expect(page.getByLabel("预估费用")).toHaveText("0.90");
    await expect(luna).toHaveValue("");
    release?.();
    await expect(page.getByRole("spinbutton", { name: "admin-added-model 快速模式倍率", exact: true })).toBeVisible();
    await expect(sol).toHaveValue("3.00");
    await sol.fill("");
    await sol.blur();
    await expect(page.getByLabel("预估费用")).toHaveText("0.60");
    await page.screenshot({ path: "../../.codex-tmp/pricing-desktop.png", fullPage: true });
  } finally { release?.(); }
});

test("admin can add a priced model with separate speed multipliers", async ({ page }) => {
  let saved: typeof bundled | undefined;
  await page.route("**/admin/api/token-cost-presets", async (route) => {
    if (route.request().method() === "PATCH") saved = route.request().postDataJSON() as typeof bundled;
    await route.fulfill({ json: saved ?? bundled });
  });
  await page.goto(harness + "?admin");
  await expect(page.getByRole("button", { name: "添加模型" })).toBeEnabled();
  await expect(page.getByRole("columnheader").last()).toHaveText("Ultrafast 倍率");
  await page.getByRole("button", { name: "添加模型" }).click();
  const row = page.locator("tbody tr").last();
  await row.getByRole("textbox", { name: "模型名称", exact: true }).fill("new-priced-model");
  await row.getByRole("spinbutton", { name: "new-priced-model input", exact: true }).fill("1.2");
  await row.getByRole("spinbutton", { name: "new-priced-model fastModeMultiplier", exact: true }).fill("3.2");
  const ultrafast = row.getByRole("spinbutton", { name: "new-priced-model Ultrafast 倍率", exact: true });
  await expect(ultrafast).toHaveValue("");
  await ultrafast.fill("4.5");
  const threshold = row.getByRole("spinbutton", { name: "new-priced-model longContextThresholdTokens", exact: true });
  await expect(threshold).toBeDisabled();
  await row.getByRole("switch", { name: "new-priced-model long context", exact: true }).click();
  await expect(threshold).toHaveAttribute("placeholder", "272000");
  await threshold.fill("128000");
  await page.getByRole("button", { name: "保存预设" }).click();
  await expect(page.getByText("已保存，用户下次启动 PC 端时生效。")).toBeVisible();
  expect(saved?.models.at(-1)).toMatchObject({ model: "new-priced-model", input: 1.2, fastModeMultiplier: 3.2,
    longContextThresholdTokens: 128000, ultrafastModeMultiplier: 4.5 });
  await page.screenshot({ path: "../../.codex-tmp/pricing-admin.png", fullPage: true });
});

test("desktop estimates follow saved and cleared Ultrafast multipliers", async ({ page }) => {
  let saved = bundled;
  await page.route("**/admin/api/token-cost-presets", async (route) => {
    if (route.request().method() === "PATCH") saved = route.request().postDataJSON();
    await route.fulfill({ json: saved });
  });
  await page.route((url) => url.pathname === "/token-cost-presets", (route) => route.fulfill({ json: saved }));
  const field = page.getByRole("spinbutton", { name: "gpt-6-sol Ultrafast 倍率", exact: true });
  for (const [value, cost] of [["3.5", "1.05"], ["", "0.30"]]) {
    await page.goto(harness + "?admin");
    await field.fill(value);
    await field.blur();
    await saveAdminPresets(page);
    await page.goto(harness + "?admin&readonly");
    await expect(field).toBeDisabled();
    await expect(field).toHaveValue(value);
    await page.goto(harness + "?tier=ultrafast");
    await expect(page.getByLabel("预估费用")).toHaveText(cost);
  }
});

test("model thresholds flow from admin to PC and local edits stay responsive during refresh", async ({ page }) => {
  let saved: typeof bundled | undefined;
  await page.route("**/admin/api/token-cost-presets", async (route) => {
    if (route.request().method() === "PATCH") saved = route.request().postDataJSON() as typeof bundled;
    await route.fulfill({ json: saved ?? bundled });
  });
  await page.goto(harness + "?admin");
  const adminThreshold = page.getByRole("spinbutton", { name: "gpt-6-sol longContextThresholdTokens", exact: true });
  await adminThreshold.fill("128000");
  await saveAdminPresets(page);
  await page.reload();
  await expect(adminThreshold).toHaveValue("128000");
  await page.goto(harness + "?admin&readonly");
  await expect(adminThreshold).toBeDisabled();

  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname === "/token-cost-presets", async (route) => {
    await pending;
    await route.fulfill({ json: saved });
  });
  await page.goto(harness);
  const threshold = page.getByRole("spinbutton", { name: "gpt-6-sol 长上下文计费起点", exact: true });
  await expect(threshold).toHaveAttribute("placeholder", "272000");
  await threshold.fill("50000");
  await threshold.blur();
  await expect(page.getByLabel("预估费用")).toHaveText("1.10");
  release?.();
  await expect(threshold).toHaveAttribute("placeholder", "128000");
  await expect(threshold).toHaveValue("50000");
  await page.reload();
  await expect(threshold).toHaveValue("50000");
  await threshold.fill("");
  await threshold.blur();
  await expect(page.getByLabel("预估费用")).toHaveText("0.60");
  await expect(threshold).toHaveAttribute("placeholder", "128000");
  await page.screenshot({ path: "../../.codex-tmp/pricing-threshold-desktop.png", fullPage: true });

  await page.goto(harness + "?admin");
  await adminThreshold.fill("");
  await adminThreshold.blur();
  await saveAdminPresets(page);
  await page.goto(harness);
  await expect(threshold).toHaveAttribute("placeholder", "272000");
});

test("thresholds remain editable while the usage dashboard polls", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("codex-switch:language", "zh");
    localStorage.setItem("codex-switch:token-usage-refresh-seconds", "1");
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#token-usage");
  await page.getByRole("button", { name: "自定义计费", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const threshold = dialog.getByRole("spinbutton", { name: "gpt-6-sol 长上下文计费起点", exact: true });
  await threshold.fill("128000");
  await threshold.blur();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(
    "codex-switch:model-long-context-thresholds",
  ) ?? "{}")["gpt-6-sol"])).toBe(128000);
  // Exercise several polling cycles while the editor is open.
  await page.waitForTimeout(2200);
  await expect(threshold).toHaveValue("128000");
  await threshold.fill("64000");
  await threshold.blur();
  await page.screenshot({ path: "../../.codex-tmp/pricing-threshold-polling.png", fullPage: true });
  await dialog.getByRole("button", { name: "关闭自定义计费", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "自定义计费", exact: true }).click();
  await expect(threshold).toHaveValue("64000");
  expect(errors).toEqual([]);
});
