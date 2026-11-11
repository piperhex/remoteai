import { GuiController } from './controller';
import { guiComposer } from './composerBridge';
import { guiSidebar } from './sidebarBridge';
import { hasLocalBackend, invoke } from '../../api/backend';
import type { GuiAccountSelection } from '../../../../../shared/remote-chat/guiAccounts';
import { modelSettingsApi } from './modelSettingsApi';
import { queueStorage } from './queueStorage';
import { watchModelCatalog } from './modelCatalogRefresh';
import { readGuiProviderModels } from './providerModelSource';
import { isClaudeAccountId } from '../../../../../shared/accounts/claudeAccounts';

let controller: GuiController | undefined;
let owners = 0;
let detach: (() => void) | undefined;

/** The workspace and remote host share one queue, including before the GUI is first opened. */
export function getGuiController() { return controller ??= new GuiController(hasLocalBackend ? queueStorage : undefined); }

export function switchGuiAccount(selection: GuiAccountSelection) {
  if (selection.kind === 'account' && isClaudeAccountId(selection.id)) {
    return invoke('claude_account_request', { request: { action: 'activate', id: selection.id } })
      .then(() => selection);
  }
  return getGuiController().modelCatalog.switchSource(() =>
    invoke<GuiAccountSelection>('codex_gui_switch_account', { selection }));
}

export function retainGuiSession() {
  const current = getGuiController();
  if (owners++ === 0) {
    current.activate();
    if (hasLocalBackend) current.modelCatalog.setProviderSource(readGuiProviderModels);
    const models = hasLocalBackend ? current.modelSettings.start(modelSettingsApi) : undefined;
    const catalog = hasLocalBackend ? watchModelCatalog(current.modelCatalog, current.report) : undefined;
    const composer = guiComposer.attach(current);
    const sidebar = guiSidebar.attach(current);
    detach = () => { models?.(); catalog?.(); composer(); sidebar(); current.dispose(); };
  }
  return () => { if (--owners === 0) { detach?.(); detach = undefined; } };
}
