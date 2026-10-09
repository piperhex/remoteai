// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfigProvider } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as backend from "../api/backend";
import { loadOfficialUsage } from "../api/officialUsage";
import { translate, type Translate } from "../i18n";
import { loadTokenCostDisplaySettings } from "../utils/tokenCost";
import { TokenCostSettingsCard } from "./TokenCostUnitSettings";
import { OfficialAccountUsage } from "./TokenUsageDashboard/OfficialAccountUsage";

vi.mock("../api/officialUsage", () => ({ loadOfficialUsage: vi.fn() }));
vi.mock("../api/backend", async (original) => ({
  ...await original<typeof backend>(), fetchCloudCurrencyRates: vi.fn(),
}));
const t: Translate = (key, values) => translate("zh", key, values);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {} }));
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getStyle(element));
  vi.mocked(backend.fetchCloudCurrencyRates).mockResolvedValue({ currencies: [
    { code: "USD", name: "USD", rate: 1 }, { code: "CNY", name: "人民币", rate: 7 },
  ], updatedAt: null });
  vi.mocked(loadOfficialUsage).mockResolvedValue({ status: "ready", updatedAt: 0, accounts: [{
    accountId: "official", accountLabel: "Example", costUsd: 10, tokens: 200, remainingUsd: 30,
    primary: { capacityUsd: 100, remainingUsd: 30, consumedUsd: 10, declinePercent: 10,
      startPercent: 40, remainingPercent: 30, startTs: 0, endTs: 1 }, secondary: null,
    devices: [{ deviceId: "device", deviceName: "Desktop", costUsd: 10, tokens: 200, updatedAt: 1 }],
  }] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <TokenCostSettingsCard providers={[]} t={t} />
    <OfficialAccountUsage language="zh" refreshSeconds={60} startTs={0} refreshKey={0} />
  </ConfigProvider>));
}

async function click(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

async function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("opens from Settings and updates all official costs and quotas after saving", async () => {
  await render();
  expect(container.querySelector(".settings-card-copy")?.textContent).toContain("所有价格与金额展示");
  await click('.settings-card button[aria-label="成本显示设置"]');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("显示单位");
  await fill("#token-cost-unit", "元");
  await fill("#token-cost-multiplier", "7");
  expect(container.textContent).toContain("预估可用额度（USD）");
  await click(".ant-modal-footer .ant-btn-primary");
  expect(loadTokenCostDisplaySettings()).toEqual({ unit: "元", usdMultiplier: 7, currencyCode: null });
  expect(container.textContent).toContain("消耗金额（元）");
  expect(container.textContent).toContain("预估可用额度（元）");
  expect(container.textContent).toContain("100% 额度预估（元）");
  expect(container.textContent).toContain("70.00 元");
  expect(container.textContent).toContain("210.00 元");
  expect(container.textContent).toContain("700.00 元");
  await click(".ant-table-row-expand-icon");
  expect(container.querySelector(".ant-table-expanded-row")?.textContent).toContain("70.00 元");
});

it("does not save cancelled or invalid drafts and reopens with the saved values", async () => {
  await render();
  await click('.settings-card button[aria-label="成本显示设置"]');
  await fill("#token-cost-unit", " ");
  expect(document.querySelector<HTMLButtonElement>(".ant-modal-footer .ant-btn-primary")?.disabled).toBe(true);
  await click(".ant-modal-close");
  expect(loadTokenCostDisplaySettings().unit).toBe("USD");
  await click('.settings-card button[aria-label="成本显示设置"]');
  expect(document.querySelector<HTMLInputElement>("#token-cost-unit")?.value).toBe("USD");
});
