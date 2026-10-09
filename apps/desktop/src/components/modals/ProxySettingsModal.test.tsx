// @vitest-environment jsdom
import { act } from "react";
import { ConfigProvider } from "antd";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadLocalProxyIpv4Addresses } from "../../api/proxyEndpoints";
import { loadProxySessions } from "../../api/backend";
import { copyLocalProxyLanApiKey, deleteLocalProxyLanApiKey, loadLocalProxyLanApiKeys,
  saveLocalProxyLanApiKey, subscribeToLocalProxyLanKeyChanges } from "../../api/localProxyLanKeys";
import type { LocalProxyLanApiKey, LocalProxyStatus, ProxySession } from "../../types";
import { ProxySessionManager } from "../ProxySessionManager";
import { ProxySettingsModal } from "./ProxySettingsModal";
import { saveTokenCostDisplaySettings } from "../../utils/tokenCost";

vi.mock("../../api/proxyEndpoints", () => ({
  LOOPBACK_IPV4: "127.0.0.1",
  loadLocalProxyIpv4Addresses: vi.fn(),
}));
vi.mock("../../api/localProxyLanKeys", () => ({
  loadLocalProxyLanApiKeys: vi.fn(),
  saveLocalProxyLanApiKey: vi.fn(),
  deleteLocalProxyLanApiKey: vi.fn(),
  copyLocalProxyLanApiKey: vi.fn(),
  subscribeToLocalProxyLanKeyChanges: vi.fn(() => () => undefined),
}));
vi.mock("../../api/backend", () => ({
  loadProxySessions: vi.fn(),
  loadProxySessionUnlimitedConversation: vi.fn().mockResolvedValue(false),
  loadProxySessionRequests: vi.fn().mockResolvedValue([]),
  setProxySessionUnlimitedConversation: vi.fn(),
}));

const proxy: LocalProxyStatus = {
  running: true, fastModeEnabled: false, fastModeAvailable: true,
  address: "127.0.0.1", port: 15722, baseUrl: "http://127.0.0.1:15722",
  autoSwitchOnQuotaExhaustion: false, concurrentAccountRoutingEnabled: false,
  customAutoSwitchPriorityEnabled: false, customAutoSwitchThresholdEnabled: false,
  globalAutoSwitchThreshold: 0, autoDisableUnreachableAccounts: false,
  systemPromptFilterEnabled: false, systemPromptFilterRules: [],
  systemPromptInjectionEnabled: false, systemPromptInjectionPrompts: [],
  listenOnAllInterfaces: false, hasLanApiKey: false,
};
const session: ProxySession = {
  id: "active-session", client: "codex_switch_gui", connectedAt: 1, lastSeenAt: 1,
  activeRequests: 1, requestCount: 1, totalTokens: 0, inputTokens: 0,
  outputTokens: 0, reasoningTokens: 0, cachedTokens: 0,
};
const onSave = vi.fn<(enabled: boolean, key?: string) => Promise<boolean>>();
const lanKey: LocalProxyLanApiKey = {
  id: "office", name: "Office laptop", keyPreview: "cs_a…1234", enabled: true,
  quotaUsd: 10, usedTokens: 12345, usedCostUsd: 2.5, remainingUsd: 7.5,
};
const onClose = vi.fn();
const notify = vi.fn();
const writeText = vi.fn();
const t = (key: string) => key;
let root: Root;
let container: HTMLDivElement;

function button(key: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((entry) => entry.textContent === key || entry.getAttribute("aria-label") === key);
  if (!result) throw new Error(`Missing button: ${key}`);
  return result;
}
const keyInput = () => document.querySelector<HTMLInputElement>("#local-proxy-api-key")!;

async function fillInput(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function render(overrides: Partial<LocalProxyStatus> = {}, open = true) {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <ProxySessionManager t={t} />
    <ProxySettingsModal open={open} proxy={{ ...proxy, ...overrides }} loading={false}
      onSave={onSave} onClose={onClose} notify={notify} t={t} />
  </ConfigProvider>));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  writeText.mockResolvedValue(undefined);
  onSave.mockResolvedValue(true);
  vi.mocked(loadLocalProxyLanApiKeys).mockReset().mockResolvedValue([]);
  vi.mocked(saveLocalProxyLanApiKey).mockReset().mockResolvedValue([lanKey]);
  vi.mocked(deleteLocalProxyLanApiKey).mockReset().mockResolvedValue([]);
  vi.mocked(copyLocalProxyLanApiKey).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadLocalProxyIpv4Addresses).mockReset().mockResolvedValue(["127.0.0.1", "192.168.1.8"]);
  vi.mocked(loadProxySessions).mockResolvedValue([session]);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("adds a generated key with a spending limit and shows its usage beside the copy action", async () => {
  await render({}, false);
  expect(loadLocalProxyIpv4Addresses).not.toHaveBeenCalled();
  await render();
  expect(button("providers.proxy.listenLan").disabled).toBe(true);
  await act(async () => button("providers.proxy.lanKeyAdd").click());
  await fillInput("#proxy-lan-key-name", lanKey.name);
  await fillInput("#proxy-lan-key-quota", "10");
  await act(async () => button("providers.proxy.generateApiKey").click());
  const generated = keyInput().value;
  expect(generated).toMatch(/^cs_[a-f0-9]{48}$/);
  expect(onSave).not.toHaveBeenCalled();
  await act(async () => button("providers.proxy.saveApiKey").click());
  expect(saveLocalProxyLanApiKey).toHaveBeenCalledWith({ id: undefined, name: lanKey.name,
    apiKey: generated, enabled: true, quotaUsd: 10, usageReviewThreshold: 1000 });
  expect(keyInput()).toBeNull();
  expect(document.body.textContent).toContain("12,345");
  expect(document.body.textContent).toContain("2.50 USD");
  expect(document.body.textContent).toContain("7.50 USD");
  await act(async () => button("providers.proxy.listenLan").click());
  expect(onSave).toHaveBeenLastCalledWith(true);
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([lanKey]);
  await render({ hasLanApiKey: true, listenOnAllInterfaces: true }, false);
  await render({ hasLanApiKey: true, listenOnAllInterfaces: true });
  await act(async () => button(`providers.proxy.copyLanApiKey: ${lanKey.name}`).click());
  expect(copyLocalProxyLanApiKey).toHaveBeenCalledWith(lanKey.id);
  expect(button(`providers.proxy.lanKeyEnabled: ${lanKey.name}`).disabled).toBe(true);
  expect(button(`providers.proxy.lanKeyDelete: ${lanKey.name}`).disabled).toBe(true);
});

it("converts displayed limits back to USD while preserving stored quotas", async () => {
  saveTokenCostDisplaySettings({ unit: "元", usdMultiplier: 7, currencyCode: "CNY" });
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([lanKey]);
  await render();
  expect(document.body.textContent).toContain("17.50 元");
  expect(document.body.textContent).toContain("52.50 元");
  await act(async () => button(`providers.proxy.lanKeyEdit: ${lanKey.name}`).click());
  expect(document.querySelector<HTMLInputElement>("#proxy-lan-key-quota")?.value).toBe("70");
  await fillInput("#proxy-lan-key-quota", "140");
  await act(async () => button("providers.proxy.saveApiKey").click());
  expect(saveLocalProxyLanApiKey).toHaveBeenCalledWith(expect.objectContaining({ quotaUsd: 20 }));
});

it("retains the new key after a failed update and prevents overlapping saves", async () => {
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([lanKey]);
  await render({ hasLanApiKey: true, listenOnAllInterfaces: true });
  await act(async () => button(`providers.proxy.lanKeyEdit: ${lanKey.name}`).click());
  await act(async () => button("providers.proxy.generateApiKey").click());
  const generated = keyInput().value;
  let rejectSave!: (error: Error) => void;
  vi.mocked(saveLocalProxyLanApiKey).mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
  await act(async () => {
    button("providers.proxy.saveApiKey").click();
    button("providers.proxy.saveApiKey").click();
  });
  expect(saveLocalProxyLanApiKey).toHaveBeenCalledTimes(1);
  expect(button("providers.proxy.listenLan").disabled).toBe(true);
  await act(async () => rejectSave(new Error("Secret internal path")));
  expect(keyInput().value).toBe(generated);
  expect(notify).toHaveBeenCalledWith("providers.proxy.lanKeysSaveFailed");
  expect(document.body.textContent).not.toContain("Secret internal path");
  expect(button("providers.proxy.listenLan").getAttribute("aria-checked")).toBe("true");
  await act(async () => button("providers.proxy.saveApiKey").click());
  expect(keyInput()).toBeNull();
});

it("copies each endpoint and keeps the local endpoint available when address loading fails", async () => {
  await render();
  await act(async () => button("providers.proxy.copyEndpoint: http://192.168.1.8:15722/v1").click());
  expect(writeText).toHaveBeenLastCalledWith("http://192.168.1.8:15722/v1");
  await render({}, false);
  vi.mocked(loadLocalProxyIpv4Addresses).mockRejectedValueOnce(new Error("scan failed"));
  await render();
  expect(document.body.textContent).toContain("providers.proxy.addressesFailed");
  await act(async () => button("providers.proxy.copyEndpoint: http://127.0.0.1:15722/v1").click());
  expect(writeText).toHaveBeenLastCalledWith("http://127.0.0.1:15722/v1");
});

it("stays interactive while an active session poll and address scan are pending", async () => {
  await render({}, false);
  let completePoll!: (sessions: ProxySession[]) => void;
  vi.mocked(loadProxySessions).mockImplementationOnce(() => new Promise((resolve) => { completePoll = resolve; }));
  await act(async () => vi.advanceTimersByTime(2_000));
  let completeScan!: (addresses: string[]) => void;
  vi.mocked(loadLocalProxyIpv4Addresses).mockImplementationOnce(() => new Promise((resolve) => {
    completeScan = resolve;
  }));
  await render();
  await act(async () => vi.advanceTimersByTime(6_000));
  expect(loadProxySessions).toHaveBeenCalledTimes(2);
  await act(async () => button("providers.proxy.lanKeyAdd").click());
  await act(async () => button("providers.proxy.generateApiKey").click());
  expect(keyInput().value).toMatch(/^cs_/);
  await act(async () => document.querySelector<HTMLButtonElement>(".proxy-settings-modal .ant-modal-close")!.click());
  expect(onClose).toHaveBeenCalledOnce();
  await render({}, false);
  await render();
  expect(loadLocalProxyIpv4Addresses).toHaveBeenCalledTimes(1);
  await act(async () => {
    completeScan(["192.168.1.8"]);
    completePoll([session]);
  });
  expect(document.body.textContent).toContain("http://192.168.1.8:15722/v1");
});

it("allows unlimited keys, preserves totals on edits, and removes only the selected key", async () => {
  const second = { ...lanKey, id: "home", name: "Home", quotaUsd: null, remainingUsd: null };
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([lanKey, second]);
  vi.mocked(saveLocalProxyLanApiKey).mockResolvedValue([lanKey, second]);
  await render({ hasLanApiKey: true, listenOnAllInterfaces: true });
  await act(async () => button(`providers.proxy.lanKeyEdit: ${second.name}`).click());
  await act(async () => button("providers.proxy.saveApiKey").click());
  expect(saveLocalProxyLanApiKey).toHaveBeenCalledWith({ id: second.id, name: second.name,
    apiKey: undefined, enabled: true, quotaUsd: null, usageReviewThreshold: 1000 });
  expect(document.body.textContent).toContain("providers.proxy.lanKeyUnlimited");
  vi.mocked(deleteLocalProxyLanApiKey).mockResolvedValue([lanKey]);
  await act(async () => button(`providers.proxy.lanKeyDelete: ${second.name}`).click());
  const confirm = document.querySelector<HTMLButtonElement>(".proxy-lan-key-confirm .ant-btn-primary")!;
  await act(async () => confirm.click());
  expect(deleteLocalProxyLanApiKey).toHaveBeenCalledWith(second.id);
  expect(document.querySelectorAll(".proxy-lan-key-row")).toHaveLength(1);
});

it("keeps usage polling single flight and ignores stale responses after saving a key", async () => {
  await render();
  let completePoll!: (keys: LocalProxyLanApiKey[]) => void;
  vi.mocked(loadLocalProxyLanApiKeys).mockImplementationOnce(() => new Promise((resolve) => {
    completePoll = resolve;
  }));
  await act(async () => vi.advanceTimersByTime(5_000));
  await act(async () => vi.advanceTimersByTime(20_000));
  expect(loadLocalProxyLanApiKeys).toHaveBeenCalledTimes(2);
  await act(async () => button("providers.proxy.lanKeyAdd").click());
  await fillInput("#proxy-lan-key-name", lanKey.name);
  await act(async () => button("providers.proxy.saveApiKey").click());
  expect(saveLocalProxyLanApiKey).toHaveBeenCalledWith({ id: undefined, name: lanKey.name,
    apiKey: undefined, enabled: true, quotaUsd: null, usageReviewThreshold: 1000 });
  await act(async () => completePoll([]));
  expect(document.body.textContent).toContain(lanKey.name);
  await render({}, false);
  await act(async () => vi.advanceTimersByTime(20_000));
  expect(loadLocalProxyLanApiKeys).toHaveBeenCalledTimes(2);
});

it("requires an explicit selection to acknowledge incomplete usage", async () => {
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([{ ...lanKey, usageIncomplete: true }]);
  await render();
  expect(document.body.textContent).toContain("providers.proxy.lanKeyUsageIncomplete");
  await act(async () => button(`providers.proxy.lanKeyEdit: ${lanKey.name}`).click());
  const checkbox = document.querySelector<HTMLInputElement>(".proxy-lan-key-usage-review input[type=checkbox]")!;
  expect(checkbox.checked).toBe(false);
  await act(async () => checkbox.click());
  await act(async () => button("providers.proxy.saveApiKey").click());
  expect(saveLocalProxyLanApiKey).toHaveBeenCalledWith(expect.objectContaining({
    id: lanKey.id, acknowledgeUsage: true,
  }));
});

it("edits the review limit, rejects invalid counts, and preserves pending usage", async () => {
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([
    { ...lanKey, unconfirmedRequests: 24, usageReviewThreshold: 25 },
  ]);
  await render();
  expect(document.body.textContent).toContain("24 / 25");
  expect(document.body.textContent).not.toContain("providers.proxy.lanKeyUsageReviewRequired");
  await act(async () => button(`providers.proxy.lanKeyEdit: ${lanKey.name}`).click());
  expect(document.querySelector<HTMLInputElement>("#proxy-lan-key-review-threshold")!.value).toBe("25");
  const form = document.querySelector("form.proxy-lan-key-editor")!;
  for (const value of ["", "0", "-1", "1.5", "1000000001"]) {
    await fillInput("#proxy-lan-key-review-threshold", value);
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(saveLocalProxyLanApiKey).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("providers.proxy.lanKeyReviewThresholdInvalid");
  }
  await fillInput("#proxy-lan-key-review-threshold", "50");
  await act(async () => button("providers.proxy.saveApiKey").click());
  expect(saveLocalProxyLanApiKey).toHaveBeenCalledWith({
    id: lanKey.id, name: lanKey.name, apiKey: undefined, enabled: true, quotaUsd: 10, usageReviewThreshold: 50,
  });
});

it("shows blocking only when a limited key reaches its configured count", async () => {
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([
    { ...lanKey, unconfirmedRequests: 25, usageReviewThreshold: 25 },
    { ...lanKey, id: "unlimited", name: "Unlimited", quotaUsd: null,
      unconfirmedRequests: 25, usageReviewThreshold: 25 },
  ]);
  await render();
  const rows = document.querySelectorAll(".proxy-lan-key-row");
  expect(rows[0].textContent).toContain("providers.proxy.lanKeyUsageReviewRequired");
  expect(rows[1].textContent).toContain("providers.proxy.lanKeyUsageIncomplete");
});

it("refreshes card counts on usage events and through LAN polling, and unsubscribes on close", async () => {
  const unsubscribe = vi.fn();
  vi.mocked(subscribeToLocalProxyLanKeyChanges).mockReturnValueOnce(unsubscribe);
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([{ ...lanKey, unconfirmedRequests: 1 }]);
  await render();
  expect(document.body.textContent).toContain("1 / 1,000");
  const onUsageChanged = vi.mocked(subscribeToLocalProxyLanKeyChanges).mock.calls[0][0];
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([{ ...lanKey, unconfirmedRequests: 2 }]);
  await act(async () => {
    onUsageChanged();
    onUsageChanged();
    vi.advanceTimersByTime(100);
  });
  expect(document.body.textContent).toContain("2 / 1,000");
  expect(loadLocalProxyLanApiKeys).toHaveBeenCalledTimes(2);
  vi.mocked(loadLocalProxyLanApiKeys).mockResolvedValue([{ ...lanKey, unconfirmedRequests: 3 }]);
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(document.body.textContent).toContain("3 / 1,000");
  await render({}, false);
  expect(unsubscribe).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(loadLocalProxyLanApiKeys).toHaveBeenCalledTimes(3);
});
