// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as backend from "../../../api/backend";
import { DEMO_ACCOUNTS } from "../../../demo";
import { AccountTable } from ".";
import { loadOfficialUsage } from '../../../api/officialUsage';

vi.mock('../../../api/officialUsage', () => ({ loadOfficialUsage: vi.fn() }));

vi.mock("../../../api/backend", async (original) => ({
  ...await original<typeof backend>(),
  loadAccountTokenUsage: vi.fn(),
  subscribeToTokenUsageChanges: vi.fn(() => vi.fn()),
}));

const account = { ...DEMO_ACCOUNTS[0], agentIdentity: false, directSwitchCompatible: true };
const usage = [{ accountId: account.id, accountEmail: null, totalTokens: 1200,
  inputTokens: 800, outputTokens: 400, reasoningTokens: 50, cachedTokens: 200, estimatedCost: 0.25 }];
const props: ComponentProps<typeof AccountTable> = {
  active: true, accounts: [account], accountGroups: [], providers: [], busyAccountId: null,
  onSwitch: vi.fn(), onDeactivate: vi.fn(), onCopyAuthJson: vi.fn(), onRefresh: vi.fn(), onDelete: vi.fn(),
  onRefreshAllUsage: vi.fn(), refreshingAllUsage: false,
  onConsumeQuotaMany: vi.fn(), onDeleteMany: vi.fn(), onEnableMany: vi.fn(), onDisableMany: vi.fn(),
  onAccountGroupChange: vi.fn(), onAutoSwitchEnabledChange: vi.fn(), autoSwitchBusyAccountId: null,
  onAutoSwitchPriorityChange: vi.fn(), autoSwitchPriorityBusyAccountId: null,
  onAutoSwitchThresholdChange: vi.fn(), autoSwitchThresholdBusyAccountId: null,
  autoSwitchOnQuotaExhaustion: false, customAutoSwitchPriorityEnabled: false,
  customAutoSwitchThresholdEnabled: false, globalAutoSwitchThreshold: 0,
  onGlobalAutoSwitchThresholdChange: vi.fn(), onSaveNote: vi.fn(), onLoadAccountDetails: vi.fn(),
  resetCredits: {}, onLoadResetCredits: vi.fn(), onUseResetCredit: vi.fn(), resetCreditBusyAccountId: null,
  hotSwitchEnabled: true, fastModeEnabled: false, concurrentAccountRoutingEnabled: false,
  concurrentAccountGroup: null, concurrentAccountRoutingBusy: false, onConcurrentAccountRoutingChange: vi.fn(),
  openaiAuthAccountId: null, openaiAuthBusy: false, onOpenaiAuthAccountChange: vi.fn(),
  privacyMode: false, privacyModeLoading: false, onPrivacyModeChange: vi.fn(), hideAccountNotes: false,
  showUsageNetworkErrors: true, displayMode: "cards", tokenUsageRefreshSeconds: 2, language: "en",
  t: (key, values) => key === "tokenUsage.dayTotal" ? `Tokens: ${values?.tokens}` : key,
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {} }));
  localStorage.clear();
  vi.mocked(backend.loadAccountTokenUsage).mockResolvedValue(usage);
  vi.mocked(loadOfficialUsage).mockResolvedValue({ accounts: [], status: 'signedOut', updatedAt: 0 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(overrides: Partial<typeof props> = {}) {
  await act(async () => root.render(<AccountTable {...props} {...overrides} />));
}

it("shows credits in a separate column and reuses usage refresh without overlapping clicks", async () => {
  // Existing saved column preferences must still include the newly added column.
  localStorage.setItem("codex-switch:account-table-column-order", JSON.stringify(["fiveHours", "oneWeek"]));
  const withCredits = { ...account, usage: { ...account.usage,
    credits: { hasCredits: true, unlimited: false, balance: "62500" } } };
  await render({ displayMode: "table", accounts: [withCredits] });
  expect(container.querySelector(".account-credits")?.textContent).toBe("62,500");
  const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="table.refreshCredits"]');
  expect(refresh?.closest("th")?.textContent).toContain("table.credits");
  await act(async () => refresh?.click());
  expect(props.onRefreshAllUsage).toHaveBeenCalledTimes(1);
  await render({ displayMode: "table", accounts: [withCredits], refreshingAllUsage: true });
  await act(async () => refresh?.click());
  expect(props.onRefreshAllUsage).toHaveBeenCalledTimes(1);
  const updated = { ...withCredits, usage: { ...withCredits.usage,
    credits: { ...withCredits.usage.credits, balance: "62000" } } };
  await render({ displayMode: "table", accounts: [updated] });
  expect(container.querySelector(".account-credits")?.textContent).toBe("62,000");
  expect(props.onRefresh).not.toHaveBeenCalled();
});

it.each([true, false])("shows recorded tokens and cost regardless of proxy running=%s", async (hotSwitchEnabled) => {
  await render({ hotSwitchEnabled });
  expect(container.querySelector(".account-card-token-summary")?.textContent).toBe("Tokens: 1.2K");
  expect(container.querySelector(".account-card-token-cost")?.textContent).toBe("0.25 USD");
  await render({ hotSwitchEnabled: !hotSwitchEnabled });
  expect(container.querySelector(".account-card-token-cost")?.textContent).toBe("0.25 USD");
});

it("shows actual zeroes when no usage was recorded", async () => {
  vi.mocked(backend.loadAccountTokenUsage).mockResolvedValue([]);
  await render();
  expect(container.querySelector(".account-card-token-summary")?.textContent).toBe("Tokens: 0");
  expect(container.querySelector(".account-card-token-cost")?.textContent).toBe("0.00 USD");
});

it('shows the combined official quota estimate in the account table in USD', async () => {
  const now = Math.floor(Date.now() / 1000);
  vi.mocked(loadOfficialUsage).mockResolvedValue({ status: 'ready', updatedAt: now,
    accounts: [{ accountId: account.id, accountLabel: account.email, tokens: 200, costUsd: 10,
      remainingUsd: 30, primary: null, secondary: null, devices: [] }],
  });
  await render({ displayMode: 'table' });
  expect(container.textContent).toContain('Estimated available (USD)');
  expect(container.textContent).toContain('$30.00');
});

it("keeps actions responsive and polling single-flight while usage is pending", async () => {
  let finish!: (value: typeof usage) => void;
  vi.mocked(backend.loadAccountTokenUsage).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await render();
  await render({ providers: [...props.providers] });
  await act(async () => vi.advanceTimersByTime(6000));
  expect(backend.loadAccountTokenUsage).toHaveBeenCalledTimes(1);
  const refresh = container.querySelector<HTMLButtonElement>(".card-header-actions .table-icon-button");
  expect(refresh).not.toBeNull();
  await act(async () => refresh?.click());
  expect(props.onRefresh).toHaveBeenCalledWith(account.id);
  await act(async () => finish(usage));
  expect(backend.loadAccountTokenUsage).toHaveBeenCalledTimes(2);
  expect(container.querySelector(".account-card-token-cost")?.textContent).toBe("0.25 USD");
  await render({ active: false });
  const calls = vi.mocked(backend.loadAccountTokenUsage).mock.calls.length;
  await act(async () => vi.advanceTimersByTime(6000));
  expect(backend.loadAccountTokenUsage).toHaveBeenCalledTimes(calls);
});
