import { uiText } from "../../../../../shared/localization/uiText";
import { Button, Tooltip } from "antd";
import { ArrowUp, Play, Square } from "lucide-react";
import type { GuiController } from "./controller";
import type { GuiState } from "../../../../../shared/conversation/types";
import styles from "./ComposerSubmit.module.less";
import { CONTINUE_MESSAGE } from "../../../../../shared/conversation/continuation";
import { modelSelectionError } from "../../../../../shared/conversation/modelSelection";
import { useMessageQueueEnabled } from "../../../../../shared/chat/useMessageQueueEnabled";

export function ComposerSubmit({ state, controller, hasDraft, reading, onSend, goalMode = false }: {
  state: GuiState;
  controller: GuiController;
  hasDraft: boolean;
  reading: boolean;
  onSend: () => Promise<void>;
  goalMode?: boolean;
}) {
  const queueEnabled = useMessageQueueEnabled();
  const current = state.selected ? state.conversations[state.selected] : undefined;
  const interrupted = current?.turns[current.turns.length - 1]?.status === "interrupted";
  const continuing = interrupted && !hasDraft && !goalMode;
  const disabled = state.connection !== "ready" || state.sending || state.archived || reading
    || Boolean(modelSelectionError(state.models, state.settings));
  const submit = async () => {
    if (disabled) return;
    if (continuing) await controller.send(CONTINUE_MESSAGE, []);
    else if (hasDraft) await onSend();
  };

  if (current?.activeTurn && !hasDraft) return <Button type="primary" shape="circle" className={styles.button}
    icon={<Square size={14} fill="currentColor" />} aria-label={uiText("client.composer.stopGenerating")}
    onClick={() => void controller.interrupt()} />;

  const label = current?.activeTurn && queueEnabled ? uiText("client.composer.addToQueue")
    : uiText(continuing ? "client.shared.continueGeneration" : "client.shared.sendMessage");
  return <Tooltip title={label} styles={{ root: { maxWidth: 400 } }}>
    <Button type="primary" shape="circle" className={styles.button}
      icon={continuing ? <Play className={styles.play} size={17} fill="currentColor" /> : <ArrowUp size={19} />}
      aria-label={label} loading={state.sending}
      disabled={disabled || (!hasDraft && !continuing)} onClick={() => void submit()} />
  </Tooltip>;
}
