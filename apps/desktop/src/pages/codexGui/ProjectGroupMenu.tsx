import { uiText } from "../../../../../shared/localization/uiText";
import type { ReactElement } from "react";
import { App } from "antd";
import { ProjectContextMenu } from "../../../../../shared/chat/ProjectContextMenu";
import { useOpenProjectFolder } from "../../../../../shared/chat/useOpenProjectFolder";
import type { GuiController } from "./controller";
import type { GuiState } from "../../../../../shared/conversation/types";
import { fileApi } from "../../../../../shared/conversation/fileApi";
import { isDesktopApp } from "../../api/backend";
import styles from "./ThreadGroup.module.less";

export function ProjectGroupMenu({ path, label, state, controller, children }: {
  path: string; label: string; state: GuiState; controller: GuiController; children: ReactElement;
}) {
  const { message } = App.useApp();
  const openProject = useOpenProjectFolder(fileApi, uiText);
  const pinned = state.pinnedProjects.includes(path);
  const remove = async () => {
    if (await controller.projectActions.remove(path)) {
      void message.success(<span className="compact-confirm-copy">{uiText("client.conversation.projectRemovedItsConversationsAreNowInRecent")}</span>);
    }
  };
  return <ProjectContextMenu groupPath={path} label={label} pinned={pinned} removing={state.removingProject === path}
    removeDisabled={state.sending || Boolean(state.removingProject) || state.connection !== "ready"}
    onPin={() => controller.projectActions.pin(path)}
    onOpen={isDesktopApp ? () => void openProject(path) : undefined}
    onRemove={() => void remove()}
    translate={uiText} buttonClassName={styles.add}>{children}</ProjectContextMenu>;
}
