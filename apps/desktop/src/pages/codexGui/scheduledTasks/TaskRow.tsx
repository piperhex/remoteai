import { uiText } from "../../../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../../../shared/localization/errors";
import { Button, Dropdown } from "antd";
import { CheckCircle2, CirclePlay, LoaderCircle, MoreHorizontal, PauseCircle } from "lucide-react";
import { scheduleLabel, type ScheduledTask } from "./types";
import styles from "./scheduledTasks.module.less";

export type TaskAction = "edit" | "run" | "toggle" | "delete" | "open";

export function TaskRow({ task, busy, onAction }: {
  task: ScheduledTask; busy: boolean; onAction: (action: TaskAction, task: ScheduledTask) => void;
}) {
  const running = task.runStatus !== "idle";
  const Icon = running ? LoaderCircle : task.status === "completed" ? CheckCircle2
    : task.status === "paused" ? PauseCircle : CirclePlay;
  const status = running ? uiText("client.scheduledTasks.running") : task.status === "paused" ? uiText("client.downloads.paused") : "";
  const items = [
    { key: "edit", label: uiText("client.scheduledTasks.editTask"), disabled: busy || running },
    { key: "run", label: uiText("client.scheduledTasks.runNow"), disabled: busy || running },
    ...(task.status === "completed" ? [] : [{ key: "toggle",
      label: task.status === "active" ? uiText("client.scheduledTasks.pauseTask") : uiText("client.scheduledTasks.enableTask"), disabled: busy || running }]),
    { key: "open", label: uiText("client.scheduledTasks.viewTaskConversation"), disabled: !task.lastThreadId },
    { key: "delete", label: uiText("client.scheduledTasks.deleteTask"), danger: true, disabled: busy || running },
  ];
  return <div className={`${styles.taskRow} ${task.status === "paused" ? styles.paused : ""}`}>
    <Icon size={20} className={running ? styles.spinning : styles.taskIcon} aria-hidden="true" />
    <button type="button" className={styles.taskContent} disabled={busy}
      onClick={() => onAction(running && task.lastThreadId ? "open" : "edit", task)}>
      <span className={styles.taskTitle}>{task.title}</span>
      <span className={styles.taskSchedule}>{scheduleLabel(task.schedule)}{status && ` · ${status}`}</span>
      {task.error && <span className={styles.taskError}>{remoteErrorText(task.error)}</span>}
    </button>
    <Dropdown trigger={["click"]} menu={{ items, onClick: ({ key }) => onAction(key as TaskAction, task) }}
      overlayStyle={{ maxWidth: 400 }}>
      <Button type="text" className={styles.taskMenu} icon={<MoreHorizontal size={19} />}
        aria-label={uiText("client.scheduledTasks.manageTask", { value1: task.title })} />
    </Dropdown>
  </div>;
}
