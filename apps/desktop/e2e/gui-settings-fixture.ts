import { GUI_SETTINGS_OPERATIONS, type GuiSettingsAccounts, type GuiSystemPromptSettings,
  type ModelContextSettings } from '../../../shared/remote-chat/guiSettings';
import type { GuiAutoSwitchSettings } from '../../../shared/conversation/autoSwitchSettings';

const accounts: GuiSettingsAccounts = {
  accounts: [{ id: 'first', email: 'remote@example.com', expiresAt: '2027-02-28', localProxyCompatible: true,
    usage: { primary: { usedPercent: 21, remainingPercent: 79 }, secondary: null } },
  { id: 'second', email: 'backup@example.com', expiresAt: '', localProxyCompatible: true,
    usage: { primary: { usedPercent: 0, remainingPercent: 100 }, secondary: null } }],
  providers: [{ id: 'remote-provider', name: 'Remote Provider' }],
};
let autoSwitch: GuiAutoSwitchSettings = { enabled: true, switchOnQuotaExhaustion: true,
  minimumRemainingPercent: 0, mode: 'sequential', fallbackProviderId: null, accounts: [] };
let prompts: GuiSystemPromptSettings = { filterEnabled: false, filterRules: [], injectionEnabled: false,
  injectionPrompts: [{ name: '远程工作规则', text: '优先检查项目中的说明。', enabled: true }] };
const context: ModelContextSettings = { defaults: { 'remote-model': 128_000 }, overrides: {} };

export function demoGuiSettings(input: Record<string, unknown>) {
  if (!GUI_SETTINGS_OPERATIONS.has(String(input.operation))) return undefined;
  switch (input.operation) {
    case 'guiSettingsAccounts': return { value: accounts };
    case 'guiAutoSwitchRead': return { value: autoSwitch };
    case 'guiAutoSwitchWrite': autoSwitch = input.settings as GuiAutoSwitchSettings; return { value: autoSwitch };
    case 'guiModelContextRead': return { value: { ...context, usingCachedDefaults: false } };
    case 'guiModelContextWrite':
      if (input.capacity === null) delete context.overrides[String(input.model)];
      else context.overrides[String(input.model)] = Number(input.capacity);
      return { value: context };
    case 'guiSystemPromptsRead': return { value: prompts };
    case 'guiSystemPromptsWrite': prompts = input.settings as GuiSystemPromptSettings; return { value: prompts };
  }
}
