import { displayText } from '../../../../../shared/localization/uiText';
import { uiText } from "../../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../../shared/localization/errors";
import { useEffect, useState } from "react";
import { Alert, Button, Input, Modal } from "antd";
import { GOAL_STATUS } from "../../../../../shared/conversation/goalTypes";
import type { GuiController } from "./controller";
import type { GuiState } from "../../../../../shared/conversation/types";
import styles from "./ComposerExtras.module.less";

export function GoalDialog({ state, controller, onClose }: {
  state: GuiState; controller: GuiController; onClose: () => void;
}) {
  const id = state.selected;
  const goal = id ? state.goals?.[id] : null;
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [edited, setEdited] = useState(false);
  useEffect(() => { if (!edited) setObjective(goal?.objective ?? ""); }, [goal?.objective, edited]);
  const busy = Boolean(state.goalBusy || state.sending);
  const running = Boolean(id && state.conversations[id]?.activeTurn);
  const unavailable = state.connection !== "ready" || state.archived || busy;
  const blocked = running || Boolean(state.compacting || (id && state.queued[id]?.length)
    || state.approvals.some((event) => event.params.threadId === id));
  const save = async () => {
    if (await controller.goals.set({ objective, status: "active" })) onClose();
  };
  const pause = async () => {
    if (!id) return;
    if (await controller.goals.set({ threadId: id, status: "paused" })) onClose();
  };
  const error = id ? state.goalErrors?.[id] : undefined;
  return <Modal open centered title={goal ? uiText("client.composer.manageGoal") : uiText("client.composer.setGoal")} width={400}
    onCancel={onClose} closable={!busy} maskClosable={!busy} keyboard={!busy}
    footer={<div className={styles.goalActions}>
      {goal && <Button danger type="text" disabled={unavailable || running}
        onClick={async () => { if (id && await controller.goals.clear(id)) onClose(); }}>{uiText("client.mobile.removeGoal")}</Button>}
      <Button disabled={busy} onClick={onClose}>{uiText("client.accounts.cancel")}</Button>
      {goal?.status === "active" && <Button disabled={unavailable} onClick={() => void pause()}>{uiText("client.composer.pauseGoal")}</Button>}
      <Button type="primary" loading={busy} disabled={unavailable || blocked || !objective.trim()}
        onClick={() => void save()}>{goal ? uiText("client.composer.saveAndContinue") : uiText("client.composer.startGoal")}</Button>
    </div>}>
    <p className={styles.copy}>{uiText("client.composer.describeTheResultYouWantCodexWillKeepWorkingUntil")}</p>
    {goal && <div className={styles.goalStatus}>{displayText(GOAL_STATUS[goal.status])}
      <span>{uiText("client.composer.used")} {goal.tokensUsed.toLocaleString()} tokens · {Math.floor(goal.timeUsedSeconds / 60)}  {uiText("client.composer.minutes")}</span>
    </div>}
    <Input.TextArea autoFocus aria-label={uiText("client.chat.goal")} placeholder={uiText("client.composer.forExampleFinishTheLoginPageAndVerifySigningIn")}
      value={objective} maxLength={4000} autoSize={{ minRows: 4, maxRows: 8 }} disabled={unavailable || running}
      onChange={(event) => { setObjective(event.target.value); setEdited(true); }} />
    {blocked && <p className={styles.copy}>{uiText("client.composer.waitForTheCurrentTaskToFinishAndResolveQueued")}</p>}
    {error && <Alert type="warning" className={styles.goalError} message={remoteErrorText(error)}
      action={<Button size="small" onClick={() => { if (id) void controller.goals.load(id); }}>{uiText("client.terminal.retry")}</Button>} />}
  </Modal>;
}
