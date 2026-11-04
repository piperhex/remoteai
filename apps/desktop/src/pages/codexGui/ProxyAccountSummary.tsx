import { uiText } from "../../../../../shared/localization/uiText";
import type { Account, Provider } from "../../types";
import { GuiAccountSummary, GuiPrimaryQuota } from "../../../../../shared/conversation/GuiAccountSummary";
import { useProviderWallet } from "./useProviderWallet";

export function ProxyAccountSummary({ name, account, provider, thirdParty, active }: {
  name: string; account?: Account; provider?: Provider; thirdParty: boolean; active: boolean;
}) {
  const wallet = useProviderWallet(provider, active);
  const balanceLabel = provider?.balancePlatform === "codexSwitch" ? uiText("client.accounts.remainingQuota") : uiText("client.conversation.walletBalance");
  const plan = !thirdParty && account ? account.plan.trim() || uiText("client.conversation.unknownPlan") : null;
  const detail = thirdParty ? <small>{wallet === null ? uiText("client.app.thirdPartyProvider") : `${balanceLabel} ${wallet}`}</small>
    : <GuiPrimaryQuota remainingPercent={account?.usage.primary?.remainingPercent} />;
  return <GuiAccountSummary name={name} plan={plan} detail={detail} />;
}
