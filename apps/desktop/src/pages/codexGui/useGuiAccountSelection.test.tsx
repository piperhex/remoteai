// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, loadAggregateApis, subscribeToProviderEvents } from "../../api/backend";
import { DEMO_ACCOUNTS } from "../../demo";
import { subscribeGuiEvent } from "../../../../../shared/conversation/webEvents";
import { selectedGuiEntries, useGuiAccountSelection, type GuiAccountSelection } from "./useGuiAccountSelection";
import { useUsageStatus } from "./useUsageStatus";
import type { GuiEngine } from '../../../../../shared/cli-gui/types';

let engine: GuiEngine;
vi.mock('../../../../../shared/cli-gui/context', () => ({ useCliGui: () => ({ state: { engine } }) }));

vi.mock("../../api/backend", () => ({ invoke: vi.fn(), loadAggregateApis: vi.fn().mockResolvedValue([]),
  subscribeToProviderEvents: vi.fn(() => () => {}),
  hasLocalBackend: true, isHostedWebApp: false }));
vi.mock('../../../../../shared/platform/localBackend', async () => await import('../../api/backend'));
vi.mock("../../../../../shared/conversation/webEvents", () => ({ subscribeGuiEvent: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
let selection: ReturnType<typeof useGuiAccountSelection>;
let active: boolean;
const stop = vi.fn();
const first = { ...DEMO_ACCOUNTS[0], id: "first", active: false };
const second = { ...DEMO_ACCOUNTS[0], id: "second", active: true };
const claude = { ...DEMO_ACCOUNTS[0], id: `claude_${'a'.repeat(32)}`, accountSource: "claudeCode",
  localProxyCompatible: false, active: false };

function Fixture() {
  selection = useGuiAccountSelection({ active, accounts: [claude, first, second], providers: [] });
  useUsageStatus(active);
  return <output>{selection.accounts.find((account) => account.active && account.accountSource !== 'claudeCode')?.id}</output>;
}
const render = () => act(async () => root.render(<Fixture />));

beforeEach(() => {
  engine = 'codex';
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockReset().mockImplementation(async (command) =>
    command === "codex_gui_account_selection" ? { kind: "account", id: "first" } : { running: true });
  vi.mocked(subscribeGuiEvent).mockReset().mockResolvedValue(stop);
  vi.mocked(loadAggregateApis).mockReset().mockResolvedValue([]);
  stop.mockClear();
  active = true;
  container = document.createElement("div");
  root = createRoot(container);
});

it('clears the native default when Claude switches to a proxy, even if its route event arrives first', async () => {
  engine = 'claude';
  await render();
  await act(async () => { await selection.switchAccount(claude.id); });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'codex_gui_switch_account') {
      vi.mocked(subscribeGuiEvent).mock.calls[0][1]({ kind: 'provider', id: 'provider' });
      return { kind: 'provider', id: 'provider' };
    }
    return null;
  });
  await act(async () => { await selection.switchProvider('provider'); });
  expect(invoke).toHaveBeenCalledWith('claude_account_request', { request: { action: 'deactivate' } });
  expect(selection.accounts.find(account => account.id === claude.id)?.active).toBe(false);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("includes Claude defaults alongside the independent Codex GUI selection", async () => {
  await render();
  expect(selection.accounts.map(account => account.id)).toEqual([claude.id, "first", "second"]);
  expect(container.textContent).toBe("first");
});

it('switches the Claude default without replacing the Codex GUI selection', async () => {
  await render();
  vi.mocked(invoke).mockClear();
  await act(async () => { expect(await selection.switchAccount(claude.id)).toBe(true); });
  expect(invoke).toHaveBeenCalledExactlyOnceWith('claude_account_request',
    { request: { action: 'activate', id: claude.id } });
  expect(selection.accounts.find(account => account.id === claude.id)?.active).toBe(true);
  expect(container.textContent).toBe('first');
  await act(async () => { await selection.switchProvider('provider'); });
  expect(selection.accounts.find(account => account.id === claude.id)?.active).toBe(true);
});

it('preserves both selections when Claude activation fails', async () => {
  await render();
  vi.mocked(invoke).mockRejectedValueOnce(new Error('client.officialAccounts.authOverride'));
  await act(async () => { await expect(selection.switchAccount(claude.id)).rejects.toThrow('authOverride'); });
  expect(selection.accounts.find(account => account.id === claude.id)?.active).toBe(false);
  expect(container.textContent).toBe('first');
});

it("ignores shared active flags and does not mutate the shared catalog", () => {
  const entries = [{ id: "shared", active: true }, { id: "gui", active: false }];
  expect(selectedGuiEntries(entries, { kind: "account", id: "gui" }, "account"))
    .toEqual([{ id: "shared", active: false }, { id: "gui", active: true }]);
  expect(entries[0].active).toBe(true);
  expect(selectedGuiEntries(entries, { kind: "provider", id: "gui" }, "account").some((entry) => entry.active))
    .toBe(false);
  expect(selectedGuiEntries(entries, { kind: "account", id: "deleted" }, "account").some((entry) => entry.active))
    .toBe(false);
});

it("keeps usage polling responsive during a GUI switch and rejects overlapping switches", async () => {
  await render();
  expect(container.textContent).toBe("first");
  let finish!: (selection: GuiAccountSelection) => void;
  vi.mocked(invoke).mockImplementation(async (command) => command === "codex_gui_switch_account"
    ? new Promise((resolve) => { finish = resolve; }) : { running: true });
  let switching!: Promise<boolean>;
  await act(async () => { switching = selection.switchAccount("second"); });
  expect(await selection.switchProvider("third")).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(container.textContent).toBe("first");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "codex_gui_usage_summary").length)
    .toBeGreaterThan(1);
  await act(async () => { finish({ kind: "account", id: "second" }); await switching; });
  expect(container.textContent).toBe("second");
  expect(invoke).toHaveBeenCalledWith("codex_gui_switch_account", { selection: { kind: "account", id: "second" } });
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "switch_account" || command === "switch_provider"))
    .toBe(false);
});

it("retains selection on failure and receives changes from another GUI client", async () => {
  await render();
  vi.mocked(invoke).mockRejectedValueOnce(new Error("switch failed"));
  await act(async () => { await expect(selection.switchAccount("second")).rejects.toThrow("switch failed"); });
  expect(container.textContent).toBe("first");
  const receive = vi.mocked(subscribeGuiEvent).mock.calls[0][1];
  await act(async () => receive({ kind: "account", id: "second" }));
  expect(container.textContent).toBe("second");
  active = false;
  await render();
  expect(stop).toHaveBeenCalledOnce();
  vi.mocked(invoke).mockClear();
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(invoke).not.toHaveBeenCalled();
});

it("does not let a slow initial read overwrite a newer GUI selection", async () => {
  let finish!: (selection: GuiAccountSelection) => void;
  vi.mocked(invoke).mockImplementation(async (command) => command === "codex_gui_account_selection"
    ? new Promise((resolve) => { finish = resolve; }) : { running: true });
  await render();
  const receive = vi.mocked(subscribeGuiEvent).mock.calls[0][1];
  await act(async () => receive({ kind: "account", id: "second" }));
  await act(async () => finish({ kind: "account", id: "first" }));
  expect(container.textContent).toBe("second");
  expect(selection.loading).toBe(false);
});

it("refreshes aggregate choices after provider changes with only one pending read", async () => {
  await render();
  let finish!: (items: Awaited<ReturnType<typeof loadAggregateApis>>) => void;
  vi.mocked(loadAggregateApis).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const receive = vi.mocked(subscribeToProviderEvents).mock.calls.at(-1)![0];
  let pending!: void | Promise<void>;
  await act(async () => { pending = receive(); await receive(); });
  expect(loadAggregateApis).toHaveBeenCalledTimes(2);
  const aggregate = { id: "route", name: "Route", model: "shared", enabled: true, active: false,
    memberProviderIds: ["one", "two"], memberConversationCounts: {} };
  await act(async () => { finish([aggregate]); await pending; });
  expect(selection.aggregateApis).toEqual([aggregate]);
});
