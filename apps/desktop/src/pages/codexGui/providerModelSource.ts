import { uiText } from "../../../../../shared/localization/uiText";
import { invoke } from '../../api/backend';
import type { AggregateApi, Provider } from '../../types';
import type { GuiAccountSelection } from '../../../../../shared/remote-chat/guiAccounts';
import { providerModels } from './providerModels';
import type { Model } from '../../../../../shared/conversation/types';

/** Read routing from the host session; page visibility and shared active flags are irrelevant. */
export async function readGuiProviderModels(): Promise<Model[] | null> {
  const selection = await invoke<GuiAccountSelection>('codex_gui_account_selection');
  if (selection.kind !== 'provider' && selection.kind !== 'aggregate') return null;
  const providers = await invoke<Provider[]>('list_providers');
  if (selection.kind === 'aggregate') {
    const aggregates = await invoke<AggregateApi[]>('list_aggregate_apis');
    const aggregate = aggregates.find(entry => entry.id === selection.id && entry.enabled);
    if (!aggregate) throw new Error(uiText("client.conversation.thisProviderIsNoLongerAvailablePleaseChooseAnother"));
    return providerModels(providers, [{ ...aggregate, active: true }]);
  }
  const provider = providers.find(entry => entry.id === selection.id);
  if (!provider) throw new Error(uiText("client.conversation.thisProviderIsNoLongerAvailablePleaseChooseAnother"));
  return providerModels([{ ...provider, active: true }], []);
}
