import { uiText } from "../../../../../shared/localization/uiText";
import { isCodexAccount } from "../../../../../shared/accounts/source";
import { isClaudeAccountId } from '../../../../../shared/accounts/claudeAccounts';
import { useCliGui } from '../../../../../shared/cli-gui/context';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasLocalBackend, invoke, loadAggregateApis, subscribeToProviderEvents } from "../../api/backend";
import type { Account, AggregateApi, Provider } from "../../types";
import { subscribeGuiEvent } from "../../../../../shared/conversation/webEvents";
import { switchGuiAccount } from "./session";

import type { GuiAccountSelection } from "../../../../../shared/remote-chat/guiAccounts";
export type { GuiAccountSelection } from "../../../../../shared/remote-chat/guiAccounts";

export function selectedGuiEntries<T extends { id: string; active: boolean }>(
  entries: T[], selection: GuiAccountSelection, kind: "account" | "provider" | "aggregate",
): T[] {
  return entries.map((entry) => ({ ...entry, active: selection.kind === kind && entry.id === selection.id }));
}

export function useGuiAccountSelection(options: { active: boolean; accounts: Account[]; providers: Provider[] }) {
  const cli = useCliGui();
  const [selection, setSelection] = useState<GuiAccountSelection>({ kind: "none" });
  const savedClaudeId = options.accounts.find(account => account.accountSource === 'claudeCode' && account.active)?.id;
  const [claudeAccountId, setClaudeAccountId] = useState(savedClaudeId);
  useEffect(() => { setClaudeAccountId(savedClaudeId); }, [savedClaudeId]);
  const [aggregates, setAggregates] = useState<AggregateApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const switching = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [next, available] = await Promise.all([
        invoke<GuiAccountSelection>("codex_gui_account_selection"), loadAggregateApis(),
      ]);
      if (request === generation.current) { setSelection(next); setAggregates(available); setError(""); }
    } catch {
      if (request === generation.current) setError(uiText("client.workspaceActions.couldNotLoadTheCodexGuiAccountReopenThePage"));
    } finally { if (request === generation.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (!options.active || !hasLocalBackend) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void subscribeGuiEvent<GuiAccountSelection>("codex-gui-account-changed", (next) => {
      if (disposed) return;
      generation.current++;
      setSelection(next); setLoading(false); setError("");
    }).then((unsubscribe) => {
      if (disposed) { unsubscribe(); return; }
      stop = unsubscribe;
      void refresh();
    }).catch(() => {
      if (!disposed) { setLoading(false); setError(uiText("client.workspaceActions.accountUpdatesAreUnavailableReopenThePageToRetry")); }
    });
    return () => { disposed = true; generation.current++; stop?.(); };
  }, [options.active, refresh]);

  useEffect(() => {
    if (!options.active || !hasLocalBackend) return;
    let disposed = false;
    let pending = false;
    const stop = subscribeToProviderEvents(async () => {
      if (pending || disposed) return;
      pending = true;
      try {
        const available = await loadAggregateApis();
        if (!disposed) setAggregates(available);
      } catch {
        if (!disposed) setError(uiText("client.workspaceActions.couldNotLoadTheCodexGuiAccountReopenThePage"));
      } finally { pending = false; }
    });
    return () => { disposed = true; stop(); };
  }, [options.active]);

  const switchSelection = async (next: GuiAccountSelection) => {
    if (switching.current) return false;
    switching.current = true;
    const request = ++generation.current;
    try {
      const engine = cli?.state.engine;
      const saved = await switchGuiAccount(next, engine);
      // A proxy change event can advance generation before the native-default change is acknowledged.
      if (saved.kind === 'account' && isClaudeAccountId(saved.id)) setClaudeAccountId(saved.id);
      else if (engine === 'claude') setClaudeAccountId(undefined);
      if (request === generation.current) {
        if (!(saved.kind === 'account' && isClaudeAccountId(saved.id))) setSelection(saved);
        setError("");
      }
      return true;
    } finally { switching.current = false; }
  };
  const accounts = useMemo(() => options.accounts.map(account => isCodexAccount(account)
    ? { ...account, active: selection.kind === 'account' && selection.id === account.id }
    : { ...account, active: account.id === claudeAccountId }),
  [options.accounts, selection, claudeAccountId]);
  const providers = useMemo(() => selectedGuiEntries(options.providers, selection, "provider"),
    [options.providers, selection]);
  const aggregateApis = useMemo(() => selectedGuiEntries(aggregates, selection, "aggregate"), [aggregates, selection]);
  return { accounts, providers, aggregateApis, loading, error,
    switchAccount: (id: string) => switchSelection({ kind: "account", id }),
    switchProvider: (id: string) => switchSelection({ kind: "provider", id }),
    switchAggregate: (id: string) => switchSelection({ kind: "aggregate", id }) };
}
