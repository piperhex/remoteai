import type { Account, Provider } from "../types";
import { maskAccountEmail } from "../../../../shared/accounts/privacy";

const ACCOUNT_MEMBER_PREFIX = "account:";

export type AggregateMemberOption = Pick<Provider, "id" | "name" | "model" | "models"> & {
  accountId?: string;
};

export function aggregateMemberAccountId(id: string): string | null {
  return id.startsWith(ACCOUNT_MEMBER_PREFIX) ? id.slice(ACCOUNT_MEMBER_PREFIX.length) : null;
}

export function buildAggregateMembers(options: {
  providers: Provider[];
  accounts: Account[];
  officialModels: string[];
  officialLabel: string;
  privacyMode: boolean;
}): AggregateMemberOption[] {
  const { providers, accounts, officialModels, officialLabel, privacyMode } = options;
  return [...providers, ...accounts.filter(account => account.localProxyCompatible).map(account => ({
    id: `${ACCOUNT_MEMBER_PREFIX}${account.id}`,
    accountId: account.id,
    name: `${officialLabel} · ${privacyMode ? maskAccountEmail(account.email) : account.email}`,
    model: officialModels[0] ?? "",
    models: officialModels,
  }))];
}
