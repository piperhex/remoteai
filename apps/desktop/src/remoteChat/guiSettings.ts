import { invoke } from '../api/backend';
import type { Account, Provider, UsageWindow } from '../types';
import type { GuiSettingsAccounts, GuiSettingsUsage } from '../../../../shared/remote-chat/guiSettings';

function usageWindow(value?: UsageWindow | null): GuiSettingsUsage | null {
  return value ? { usedPercent: value.usedPercent, remainingPercent: value.remainingPercent,
    resetsAt: value.resetsAt, windowMinutes: value.windowMinutes } : null;
}

async function readAccounts(): Promise<GuiSettingsAccounts> {
  const [accounts, providers] = await Promise.all([
    invoke<Account[]>('list_accounts'), invoke<Provider[]>('list_providers'),
  ]);
  return {
    accounts: accounts.map(account => ({ id: account.id, email: account.email, expiresAt: account.expiresAt,
      localProxyCompatible: account.localProxyCompatible, usage: {
        primary: usageWindow(account.usage?.primary), secondary: usageWindow(account.usage?.secondary),
        apiExpiresAt: account.usage?.apiExpiresAt,
      } })),
    providers: providers.map(({ id, name }) => ({ id, name })),
  };
}

/** The authenticated connection can access only these GUI settings, never arbitrary host commands. */
export function guiSettingsRequest(body: Record<string, unknown>): Promise<unknown> {
  switch (body.operation) {
    case 'guiSettingsAccounts': return readAccounts();
    case 'guiAutoSwitchRead': return invoke('codex_gui_auto_switch_settings');
    case 'guiAutoSwitchWrite': return invoke('codex_gui_set_auto_switch_settings', { settings: body.settings });
    case 'guiModelContextRead': return invoke('codex_gui_model_context_settings');
    case 'guiModelContextWrite':
      return invoke('codex_gui_set_model_context', { model: body.model, capacity: body.capacity });
    case 'guiSystemPromptsRead': return invoke('codex_gui_system_prompt_settings');
    case 'guiSystemPromptsWrite': return invoke('codex_gui_set_system_prompt_settings', { settings: body.settings });
    default: return Promise.reject(new Error('client.workspaceActions.couldNotLoadSettingsPleaseTryAgain'));
  }
}
