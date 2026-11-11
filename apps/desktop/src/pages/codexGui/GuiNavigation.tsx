import { uiText } from "../../../../../shared/localization/uiText";
import { Clock3, FolderSync, Package, SquarePen } from "lucide-react";
import styles from "./GuiNavigation.module.less";

export type GuiView = "conversation" | "scheduled-tasks" | "plugins" | "conversation-migration";

export const GUI_VIEW_TITLES: Record<GuiView, string> = {
  get conversation() { return uiText("client.agentHub.title"); },
  get "scheduled-tasks"() { return uiText("client.workspaceSettings.scheduledTasks"); },
  get plugins() { return uiText("client.chat.plugins"); },
  get "conversation-migration"() { return uiText("client.workspaceSettings.conversationSync"); },
};

export function GuiNavigation({ view, sending, onNavigate, onNewConversation,
  scheduledTasksAvailable = true }: {
  scheduledTasksAvailable?: boolean;
  view: GuiView; sending: boolean; onNavigate: (view: GuiView) => void; onNewConversation: () => void;
}) {
  return <nav className={styles.navigation} aria-label={uiText("client.workspaceSettings.codexGuiNavigation")}>
    <button type="button" disabled={sending} onClick={onNewConversation}>
      <SquarePen size={18} strokeWidth={1.6} aria-hidden="true" /><span>{uiText("client.workspaceSettings.newConversation")}</span>
    </button>
    {scheduledTasksAvailable && <button type="button" aria-current={view === "scheduled-tasks" ? "page" : undefined}
      onClick={() => onNavigate("scheduled-tasks")}>
      <Clock3 size={18} strokeWidth={1.6} aria-hidden="true" /><span>{uiText("client.workspaceSettings.scheduledTasks")}</span>
    </button>}
    <button type="button" aria-current={view === "plugins" ? "page" : undefined}
      onClick={() => onNavigate("plugins")}>
      <Package size={18} strokeWidth={1.6} aria-hidden="true" /><span>{uiText("client.chat.plugins")}</span>
    </button>
    <button type="button" aria-current={view === "conversation-migration" ? "page" : undefined}
      onClick={() => onNavigate("conversation-migration")}>
      <FolderSync size={18} strokeWidth={1.6} aria-hidden="true" /><span>{uiText("client.workspaceSettings.conversationSync")}</span>
    </button>
  </nav>;
}
