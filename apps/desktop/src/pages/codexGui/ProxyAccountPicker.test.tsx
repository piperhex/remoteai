// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, queryProviderBalance, subscribeToProviderBalance } from "../../api/backend";
import type { Account, Provider, ProviderBalance } from "../../types";
import { ProxyAccountPicker, type ProxyAccountPickerProps } from "./ProxyAccountPicker";
import { useUsageStatus } from "./useUsageStatus";
import detailsStyles from "../../../../../shared/conversation/ProxyAccountDetails.module.less";
import type { GuiAutoSwitchSettings } from "../../../../../shared/conversation/autoSwitchSettings";
import type { GuiEngine } from '../../../../../shared/cli-gui/types';

let engine: GuiEngine;
vi.mock('../../../../../shared/cli-gui/context', () => ({ useCliGui: () => ({ state: { engine } }) }));

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), queryProviderBalance: vi.fn(),
  subscribeToProviderBalance: vi.fn(), isHostedWebApp: false, canManageCodexConnection: true }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
const account: Account = {
  id: "official", email: "user@example.com", group: "", note: "工作账号", expiresAt: "", plan: "Plus",
  privateDetails: { password: "", phoneNumber: "", totpSecret: "" }, active: true, autoSwitchEnabled: true,
  autoSwitchPriority: 0, autoSwitchThreshold: 0, localProxyCompatible: true, directSwitchCompatible: true,
  agentIdentity: false, official: true, metadataEditable: true, usage: {},
};
const provider: Provider = {
  id: "provider", kind: "custom", name: "测试 Provider", group: "", baseUrl: "https://example.com/v1",
  model: "test-model", models: [], modelReasoningEfforts: {}, modelContextWindows: {}, modelApiFormats: {},
  imageInputModels: [], imageInputModelsConfigured: false, modelSelectionControlledByCodex: true,
  fastModeEnabled: false, apiFormat: "openaiResponses", active: false, autoSwitchEnabled: false,
  hasApiKey: true, supportsDirectSwitch: false, balanceQueryUsesApiKey: true, hasBalanceQueryToken: false,
  hasWalletQueryToken: false, hasWalletLoginCredentials: false,
};
let root: Root;
let container: HTMLDivElement;
let props: ProxyAccountPickerProps;

function Fixture() {
  useUsageStatus(props.active);
  return <ProxyAccountPicker {...props} />;
}
const render = () => act(async () => root.render(<Fixture />));
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const option = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("section button"))
  .find((button) => button.textContent?.includes(text))!;
const click = (button: HTMLButtonElement) => act(async () => button.click());

it('lets Claude defaults switch from the account list without proxy compatibility or empty Codex quotas', async () => {
  props.accounts.push({ ...account, id: `claude_${'a'.repeat(32)}`, accountSource: 'claudeCode',
    email: 'claude@example.test', active: false, localProxyCompatible: false });
  await render(); await click(trigger());
  const row = option('claude@example.test');
  expect(row.disabled).toBe(false);
  expect(row.textContent).toContain('Claude Code');
  expect(row.textContent).not.toContain('不可用');
  expect(row.querySelector('[aria-label^="主用量剩余"]')).toBeNull();
  await click(row);
  expect(props.onSwitchAccount).toHaveBeenCalledWith(props.accounts[1].id);
  expect(document.body.textContent).toContain('新建会话将使用此账户');
});

beforeEach(() => {
  engine = 'codex';
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
  const getComputedStyle = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  vi.mocked(invoke).mockReset().mockResolvedValue({ running: true });
  vi.mocked(queryProviderBalance).mockReset();
  vi.mocked(subscribeToProviderBalance).mockReset().mockReturnValue(vi.fn());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = { active: true, privacyMode: false, accounts: [account], providers: [provider],
    aggregateApis: [],
    busy: false, loading: false, onSwitchAccount: vi.fn().mockResolvedValue(true),
    onSwitchProvider: vi.fn().mockResolvedValue(true) };
});

it('keeps both defaults in the list but selects only the current engine, including proxy fallback', async () => {
  const claude = { ...account, id: `claude_${'b'.repeat(32)}`, accountSource: 'claudeCode',
    email: 'claude@example.test', active: true };
  props.accounts.push(claude);
  props.providers = [{ ...provider, active: true }];
  await render(); await click(trigger());
  expect(option(claude.email).getAttribute('aria-pressed')).toBe('false');
  expect(option(provider.name).getAttribute('aria-pressed')).toBe('true');
  engine = 'claude'; await render();
  expect(trigger().textContent).toContain(claude.email);
  expect(option(claude.email).getAttribute('aria-pressed')).toBe('true');
  expect(option(provider.name).getAttribute('aria-pressed')).toBe('false');
  expect(option(account.email).getAttribute('aria-pressed')).toBe('false');
  engine = 'gemini'; await render();
  expect(trigger().textContent).toContain(provider.name);
  expect(option(claude.email).getAttribute('aria-pressed')).toBe('false');
  expect(option(provider.name).getAttribute('aria-pressed')).toBe('true');
  engine = 'claude';
  props.accounts = props.accounts.map(entry => ({ ...entry, active: false }));
  await render();
  expect(trigger().textContent).toContain(provider.name);
  expect(option(provider.name).getAttribute('aria-pressed')).toBe('true');
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  { email: "user@example.com", masked: "user@*****e.com" },
  { email: "ab@cd.test", masked: "*****" },
  { email: "a@b.co", masked: "*****" },
])("masks $email only in the trigger while privacy mode is enabled", async ({ email, masked }) => {
  props.accounts = [{ ...account, email }];
  props.privacyMode = true;
  await render();
  expect(trigger().textContent).toContain(masked);
  expect(trigger().outerHTML).not.toContain(email);
  expect(trigger().getAttribute("aria-label")).toBe(`切换 GUI 账户：${masked}`);
  await click(trigger());
  expect(option(email).textContent).toContain(email);
  props.privacyMode = false;
  await render();
  expect(trigger().textContent).toContain(email);
  expect(trigger().getAttribute("aria-label")).toBe(`切换 GUI 账户：${email}`);
  props.privacyMode = true;
  await render();
  expect(trigger().outerHTML).not.toContain(email);
  expect(option(email).textContent).toContain(email);
});

it("keeps provider names visible in privacy mode", async () => {
  props.privacyMode = true;
  props.providers = [{ ...provider, active: true }];
  await render();
  expect(trigger().textContent).toContain(provider.name);
});

it.each(["custom", "openai"] as const)(
  "shows and switches a %s Provider alongside official accounts", async (kind) => {
  const target = { ...provider, kind, name: kind === "openai" ? "Remote AI" : provider.name };
  props.providers = [target];
  await render();
  expect(trigger().textContent).toContain(account.email);
  await click(trigger());
  expect(option(account.email).getAttribute("aria-pressed")).toBe("true");
  await click(option(target.name));
  expect(props.onSwitchProvider).toHaveBeenCalledWith(target.id);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  // An active login account may coexist with a third-party proxy target.
  props.providers = [{ ...target, active: true }];
  await render();
  expect(trigger().textContent).toContain(target.name);
  expect(trigger().textContent).not.toContain(account.email);
  await click(trigger());
  expect(option(target.name).getAttribute("aria-pressed")).toBe("true");
  expect(option(account.email).getAttribute("aria-pressed")).toBe("false");
  await click(option(account.email));
  expect(props.onSwitchAccount).toHaveBeenCalledWith(account.id);
});

it.each([
  { label: "personal login", official: false, agentIdentity: false },
  { label: "pool account", official: true, agentIdentity: false },
  { label: "proxy-compatible agent account", official: false, agentIdentity: true },
])("shows and switches a $label regardless of account provenance", async ({ official, agentIdentity }) => {
  props.accounts = [{ ...account, official, agentIdentity }];
  await render();
  await click(trigger());
  expect(option(account.email).getAttribute("aria-pressed")).toBe("true");
  expect(option(account.email).disabled).toBe(false);

  props.providers = [{ ...provider, active: true }];
  await render();
  expect(option(account.email).getAttribute("aria-pressed")).toBe("false");
  await click(option(account.email));
  expect(props.onSwitchAccount).toHaveBeenCalledWith(account.id);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it.each(["custom", "openai"] as const)(
  "keeps polling and the open list responsive while switching a %s Provider", async (kind) => {
  props.providers = [{ ...provider, kind }];
  let finish!: (success: boolean) => void;
  props.onSwitchProvider = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  await render();
  await click(trigger());
  await click(option(provider.name));
  await click(option(provider.name));
  expect(option(account.email).disabled).toBe(true);
  const usageCalls = () => vi.mocked(invoke).mock.calls
    .filter(([command]) => command === "codex_gui_usage_summary");
  expect(usageCalls()).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(usageCalls()).toHaveLength(3);
  expect(props.onSwitchProvider).toHaveBeenCalledOnce();
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  props.accounts = [{ ...account, usage: { primary: { usedPercent: 75, remainingPercent: 25 } } }];
  await render();
  expect(option(account.email).textContent).toContain("主25%");
  await act(async () => {
    document.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  await act(async () => finish(true));
});

it.each([
  { remaining: 0, tone: "danger" },
  { remaining: 15, tone: "danger" },
  { remaining: 16, tone: "warning" },
  { remaining: 35, tone: "warning" },
  { remaining: 36, tone: "good" },
  { remaining: 100, tone: "good" },
])("shows plan and remaining quotas with the account-table tone at $remaining%", async ({ remaining, tone }) => {
  props.accounts = [{ ...account, usage: {
    primary: { usedPercent: 100 - remaining, remainingPercent: remaining },
    secondary: { usedPercent: 72.6, remainingPercent: 27.4 },
  } }];
  await render();
  await click(trigger());
  const item = option(account.email);
  expect(item.textContent).toContain(account.plan);
  expect(item.textContent).not.toContain(account.note);
  const primary = item.querySelector(`[aria-label="主用量剩余 ${remaining}%"] strong`);
  expect(primary?.classList.contains(detailsStyles[tone])).toBe(true);
  const secondary = item.querySelector('[aria-label="次用量剩余 27%"] strong');
  expect(secondary?.classList.contains(detailsStyles.warning)).toBe(true);
  expect(option(provider.name).textContent).toContain(provider.model);
  expect(option(provider.name).textContent).not.toContain("主");
});

it("shows neutral placeholders for unavailable quotas", async () => {
  props.accounts = [{ ...account, usage: { primary: null,
    secondary: { usedPercent: Number.NaN, remainingPercent: Number.NaN } } }];
  await render();
  await click(trigger());
  const item = option(account.email);
  expect(item.textContent).toContain("主—次—");
  expect(item.querySelectorAll(`.${detailsStyles.quota} strong[class]`)).toHaveLength(0);
  expect(item.textContent).not.toContain(account.note);
});

it("preserves selection on failure and allows retry without exposing internal errors", async () => {
  props.onSwitchProvider = vi.fn().mockRejectedValueOnce(new Error("private-path-secret"))
    .mockResolvedValueOnce(true);
  await render();
  await click(trigger());
  await click(option(provider.name));
  expect(trigger().textContent).toContain(account.email);
  expect(document.querySelector("[role=alert]")?.textContent).toBe("切换未完成，请重试。");
  expect(document.body.textContent).not.toContain("private-path-secret");
  await click(option(provider.name));
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("allows GUI selection without starting the external proxy and blocks pending operations", async () => {
  await render();
  await click(trigger());
  expect(document.body.textContent).not.toContain("开启本地代理");
  expect(option(provider.name).disabled).toBe(false);
  props.busy = true;
  await render();
  await click(option(provider.name));
  expect(props.onSwitchProvider).not.toHaveBeenCalled();
  props.busy = false;
  props.accounts = [{ ...account, official: false, localProxyCompatible: false }];
  await render();
  expect(option(account.email).disabled).toBe(true);
});

it("tracks external selection updates and closes the list when leaving the page", async () => {
  await render();
  await click(trigger());
  props.providers = [{ ...provider, active: true }];
  await render();
  expect(trigger().textContent).toContain(provider.name);
  expect(option(provider.name).getAttribute("aria-pressed")).toBe("true");
  props.active = false;
  await render();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  const calls = vi.mocked(invoke).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(invoke).toHaveBeenCalledTimes(calls);
});

it.each([0, 25, 100])("shows the current plan and primary remaining progress at %s%%", async (remaining) => {
  props.accounts = [{ ...account, usage: {
    primary: { usedPercent: 100 - remaining, remainingPercent: remaining },
    secondary: { usedPercent: 90, remainingPercent: 10 },
  } }];
  await render();
  expect(trigger().textContent).toContain("Plus");
  expect(trigger().textContent).toContain(`${remaining}%`);
  expect(trigger().textContent).not.toContain("剩余");
  expect(trigger().textContent).not.toContain("官方账号");
  expect(trigger().querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(`${remaining}`);
});

it("does not present missing usage as zero remaining", async () => {
  await render();
  expect(trigger().textContent).toContain("主用量剩余 —");
  expect(trigger().querySelector('[role="progressbar"]')).toBeNull();
});

const balance: ProviderBalance = { apiAmount: 99, apiUnit: "USD", apiUnlimited: false,
  walletAmount: 12.34, walletUnit: "CNY", queriedAt: 1 };

it.each([0, 7.5])("shows Remote AI key quota %s in the proxy summary", async (amount) => {
  props.providers = [{ ...provider, active: true, balancePlatform: "codexSwitch" }];
  vi.mocked(queryProviderBalance).mockResolvedValue({ ...balance, apiAmount: amount, walletAmount: null });
  await render();
  expect(trigger().textContent).toContain(`剩余额度 ${amount.toFixed(2)} USD`);
  expect(trigger().textContent).not.toContain("钱包余额");
});

it("shows unlimited Remote AI keys without treating them as a zero balance", async () => {
  props.providers = [{ ...provider, active: true, balancePlatform: "codexSwitch" }];
  vi.mocked(queryProviderBalance).mockResolvedValue({ ...balance,
    apiAmount: null, apiUnlimited: true, walletAmount: null });
  await render();
  expect(trigger().textContent).toContain("剩余额度 不限额");
});

it.each([0, 12.34, -2, null, Number.NaN])("prefers the wallet amount %s over API quota", async (amount) => {
  props.providers = [{ ...provider, active: true, balancePlatform: "newApi" }];
  vi.mocked(queryProviderBalance).mockResolvedValue({ ...balance, walletAmount: amount });
  await render();
  expect(trigger().textContent).toContain(typeof amount === "number" && Number.isFinite(amount)
    ? `钱包余额 ${amount.toFixed(2)} CNY` : "第三方 Provider");
  expect(trigger().textContent).not.toContain("Plus");
  expect(trigger().textContent).not.toContain("99");
  expect(trigger().querySelector('[role="progressbar"]')).toBeNull();
});

it("keeps wallet polling single-flight and the list responsive, then cleans up on page exit", async () => {
  let finish!: (value: ProviderBalance) => void;
  const unsubscribe = vi.fn();
  props.providers = [{ ...provider, active: true, balancePlatform: "newApi" }];
  vi.mocked(subscribeToProviderBalance).mockReturnValue(unsubscribe);
  vi.mocked(queryProviderBalance).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render();
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(queryProviderBalance).toHaveBeenCalledOnce();
  await click(trigger());
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(option(account.email).disabled).toBe(false);
  await act(async () => finish(balance));
  expect(trigger().textContent).toContain("钱包余额 12.34 CNY");
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(queryProviderBalance).toHaveBeenCalledTimes(2);
  props.active = false;
  await render();
  await act(async () => finish({ ...balance, walletAmount: 55 }));
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(queryProviderBalance).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(trigger().textContent).not.toContain("55");
});

it("ignores a previous provider's late wallet response and falls back after query failure", async () => {
  let finish!: (value: ProviderBalance) => void;
  props.providers = [{ ...provider, active: true, balancePlatform: "newApi" }];
  vi.mocked(queryProviderBalance).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(new Error("private-query-error"));
  await render();
  props.providers = [{ ...provider, id: "other", name: "另一个 Provider", active: true, balancePlatform: "newApi" }];
  await render();
  await act(async () => finish(balance));
  expect(trigger().textContent).toContain("另一个 Provider第三方 Provider");
  expect(trigger().textContent).not.toContain("12.34");
  expect(trigger().textContent).not.toContain("private-query-error");
});

it("does not use an unrelated provider wallet for an aggregate API", async () => {
  props.providers = [{ ...provider, active: true, balancePlatform: "newApi" }];
  props.aggregateApis = [{ id: "aggregate", name: "聚合 API", model: "model", enabled: true, active: true,
    memberProviderIds: [provider.id], memberConversationCounts: {} }];
  await render();
  expect(trigger().textContent).toContain("聚合 API第三方 Provider");
  expect(queryProviderBalance).not.toHaveBeenCalled();
});

it("opens independent auto-switch settings from the list footer and closes them on page exit", async () => {
  const settings: GuiAutoSwitchSettings = { enabled: false, switchOnQuotaExhaustion: true,
    minimumRemainingPercent: 0, mode: "sequential", fallbackProviderId: null, accounts: [] };
  vi.mocked(invoke).mockImplementation(async (command) => command === "codex_gui_auto_switch_settings"
    ? settings : { running: true });
  await render();
  expect(invoke).not.toHaveBeenCalledWith("codex_gui_auto_switch_settings");
  await click(trigger());
  const settingsButton = document.querySelector<HTMLButtonElement>('button[aria-label="Agent Hub 设置"]')!;
  expect(settingsButton.getAttribute("aria-haspopup")).toBe("dialog");
  await click(settingsButton);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Agent Hub 设置");
  expect(invoke).toHaveBeenCalledWith("codex_gui_auto_switch_settings");
  expect(props.onSwitchAccount).not.toHaveBeenCalled();
  props.active = false;
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("waits for the account catalog before allowing automatic switching settings to open", async () => {
  props.loading = true;
  await render();
  await click(trigger());
  const settingsButton = document.querySelector<HTMLButtonElement>('button[aria-label="Agent Hub 设置"]')!;
  expect(settingsButton.disabled).toBe(true);
  await click(settingsButton);
  expect(invoke).not.toHaveBeenCalledWith("codex_gui_auto_switch_settings");
  props.loading = false;
  await render();
  expect(settingsButton.disabled).toBe(false);
});

it("keeps the panel within 280px and the viewport, and cleans up on page exit", async () => {
  const removeListener = vi.spyOn(window, "removeEventListener");
  await render();
  await click(trigger());
  const popup = () => document.querySelector<HTMLElement>(".ant-popover")!;
  expect(popup().style.width).toBe("280px");
  vi.stubGlobal("innerWidth", 300);
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(popup().style.width).toBe("276px");
  props.active = false;
  await render();
  expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
});
