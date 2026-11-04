import { invoke } from '../api/backend';
import type { Account, AggregateApi, Provider } from '../types';
import { object } from '../../../../shared/remote-chat/protocol';
import type { GuiAccountSelection, GuiAccountsSnapshot } from '../../../../shared/remote-chat/guiAccounts';
import { guiAccountBalances } from './guiAccountBalances';
import { providerWebsiteOrigin } from '../../../../shared/provider-market/providerWebsite';
import { switchGuiAccount } from '../pages/codexGui/session';
import { uiText } from "../../../../shared/localization/uiText";

function remainingPercent(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

// Remote clients render these fields verbatim, so the host formats them in its interface language.
function accountPlan(account: Account) {
  return account.plan?.trim() || account.usage?.plan?.trim() || uiText("client.conversation.unknownPlan");
}

function accountDetail(account: Account) {
  const plan = accountPlan(account);
  const primary = remainingPercent(account.usage?.primary?.remainingPercent);
  const secondary = remainingPercent(account.usage?.secondary?.remainingPercent);
  return uiText("client.remoteHostData.remainingPrimarySecondary", { plan, primary, secondary });
}

export async function readGuiAccounts(): Promise<GuiAccountsSnapshot> {
  const [selection, accounts, providers, aggregates] = await Promise.all([
    invoke<GuiAccountSelection>('codex_gui_account_selection'),
    invoke<Account[]>('list_accounts'),
    invoke<Provider[]>('list_providers'),
    invoke<AggregateApi[]>('list_aggregate_apis'),
  ]);
  // Only send picker display fields; account credentials and private details stay on the computer.
  return {
    selection, running: true,
    choices: [
      ...accounts.map((account) => ({
        kind: 'account' as const, id: account.id, name: account.email,
        detail: accountDetail(account), searchDetail: account.note, available: account.localProxyCompatible,
        plan: accountPlan(account), primaryRemainingPercent: account.usage?.primary?.remainingPercent ?? null,
        secondaryRemainingPercent: account.usage?.secondary?.remainingPercent ?? null,
      })),
      ...providers.map((provider) => ({
        kind: 'provider' as const, id: provider.id, name: provider.name,
        detail: guiAccountBalances.detail(provider), searchDetail: provider.model, available: true,
        websiteUrl: providerWebsiteOrigin(provider),
      })),
      ...(aggregates ?? []).map((aggregate) => ({
        kind: 'aggregate' as const, id: aggregate.id, name: aggregate.name,
        detail: aggregate.model, available: aggregate.enabled,
      })),
    ],
  };
}

export async function selectGuiAccount(value: unknown): Promise<GuiAccountSelection> {
  const selection = object(value);
  if (!['account', 'provider', 'aggregate'].includes(String(selection.kind))
    || typeof selection.id !== 'string' || !selection.id.trim() || selection.id.length > 160) {
    return Promise.reject(new Error('请选择可用账户。'));
  }
  return switchGuiAccount({ kind: selection.kind as 'account' | 'provider' | 'aggregate', id: selection.id });
}
