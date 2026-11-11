import type { Account } from "../../types";

type AccountSelectorInput = Pick<Account,
  "localProxyCompatible" | "directSwitchCompatible" | "accountSource">;

export function getSwitchableAccounts<T extends AccountSelectorInput>(accounts: T[], hotSwitchEnabled: boolean) {
  return accounts.filter((account) => account.accountSource === "claudeCode" || (hotSwitchEnabled
    ? account.localProxyCompatible
    : account.directSwitchCompatible));
}
