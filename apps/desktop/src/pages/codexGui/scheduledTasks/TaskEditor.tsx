import { displayText } from '../../../../../../shared/localization/uiText';
import { uiText } from "../../../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../../../shared/localization/errors";
import { useState } from "react";
import { Alert, Button, Input, InputNumber, Modal, Select } from "antd";
import type { Schedule, TaskInput } from "./types";
import { WEEKDAYS } from "./types";
import styles from "./scheduledTasks.module.less";

const MAX_PROMPT_LENGTH = 20_000;
const DEFAULT_DELAY_MS = 60 * 60 * 1000;
const FREQUENCIES = [
  { value: "once", get label() { return uiText("client.scheduledTasks.once"); } }, { value: "interval", get label() { return uiText("client.scheduledTasks.repeatAtIntervals"); } },
  { value: "daily", get label() { return uiText("client.chat.daily"); } }, { value: "weekdays", get label() { return uiText("client.scheduledTasks.everyWeekday"); } },
  { value: "weekly", get label() { return uiText("client.scheduledTasks.weekly"); } },
];

function localDateInput(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function initialSchedule(kind: Schedule["kind"]): Schedule {
  if (kind === "once") return { kind, at: Date.now() + DEFAULT_DELAY_MS };
  if (kind === "interval") return { kind, minutes: 5 };
  if (kind === "weekly") return { kind, time: "09:00", weekday: 0 };
  return { kind, time: "09:00" };
}

function ScheduleFields({ value, onChange, disabled }: {
  value: Schedule; onChange: (schedule: Schedule) => void; disabled: boolean;
}) {
  return <div className={styles.scheduleFields}>
    <Select aria-label={uiText("client.scheduledTasks.repeat")} value={value.kind} options={FREQUENCIES} disabled={disabled}
      onChange={(kind: Schedule["kind"]) => onChange(initialSchedule(kind))} />
    {value.kind === "once" && <Input type="datetime-local" aria-label={uiText("client.scheduledTasks.runTime")} disabled={disabled}
      value={Number.isFinite(value.at) ? localDateInput(value.at) : ""}
      onChange={(event) => onChange({ ...value, at: new Date(event.target.value).getTime() })} />}
    {value.kind === "interval" && <div className={styles.interval}>
      <span>{uiText("client.scheduledTasks.every")}</span><InputNumber aria-label={uiText("client.scheduledTasks.intervalInMinutes")} min={1} max={525_600} precision={0}
        value={value.minutes} disabled={disabled}
        onChange={(minutes) => onChange({ ...value, minutes: minutes ?? 1 })} /><span>{uiText("client.composer.minutes")}</span>
    </div>}
    {value.kind === "weekly" && <Select aria-label={uiText("client.scheduledTasks.dayOfWeek")} value={value.weekday} disabled={disabled}
      options={WEEKDAYS.map((label, index) => ({ label: displayText(label), value: index }))}
      onChange={(weekday) => onChange({ ...value, weekday })} />}
    {"time" in value && <Input type="time" aria-label={uiText("client.scheduledTasks.runTime")} value={value.time} disabled={disabled}
      onChange={(event) => onChange({ ...value, time: event.target.value })} />}
  </div>;
}

export function TaskEditor({ initial, editing, busy, error, onClose, onSave }: {
  initial: TaskInput; editing: boolean; busy: boolean; error: string;
  onClose: () => void; onSave: (input: TaskInput) => Promise<boolean>;
}) {
  const [input, setInput] = useState(initial);
  const scheduleValid = input.schedule.kind === "once"
    ? input.schedule.at > Date.now() : !("time" in input.schedule) || Boolean(input.schedule.time);
  const valid = Boolean(input.title.trim() && input.prompt.trim() && scheduleValid);
  const save = async () => { if (valid && !busy && await onSave(input)) onClose(); };
  return <Modal open centered width={400} title={editing ? uiText("client.scheduledTasks.editScheduledTask") : uiText("client.scheduledTasks.createScheduledTask")}
    className={styles.editor} onCancel={onClose} maskClosable={!busy} closable={!busy} keyboard={!busy}
    footer={<><Button disabled={busy} onClick={onClose}>{uiText("client.accounts.cancel")}</Button>
      <Button className={styles.create} type="primary" disabled={!valid} loading={busy}
        onClick={() => void save()}>{editing ? uiText("client.projectBrowser.save") : uiText("client.scheduledTasks.createTask")}</Button></>}>
    <label className={styles.field}>{uiText("client.scheduledTasks.taskName")}<Input autoFocus value={input.title} maxLength={120}
      placeholder={uiText("client.scheduledTasks.forExampleWatchForNewReleases")} disabled={busy}
      onChange={(event) => setInput({ ...input, title: event.target.value })} /></label>
    <label className={styles.field}>{uiText("client.scheduledTasks.taskInstructions")}<Input.TextArea value={input.prompt} maxLength={MAX_PROMPT_LENGTH}
      autoSize={{ minRows: 3, maxRows: 7 }} placeholder={uiText("client.scheduledTasks.tellCodexWhatToDo")} disabled={busy}
      onChange={(event) => setInput({ ...input, prompt: event.target.value })} /></label>
    <div className={styles.field}><span>{uiText("client.scheduledTasks.schedule")}</span><ScheduleFields value={input.schedule} disabled={busy}
      onChange={(schedule) => setInput({ ...input, schedule })} /></div>
    <label className={styles.field}>{uiText("client.scheduledTasks.projectFolderOptional")}<Input value={input.cwd} disabled={busy}
      placeholder={uiText("client.scheduledTasks.youCanCreateATaskWithoutAProjectFolder")}
      onChange={(event) => setInput({ ...input, cwd: event.target.value })} /></label>
    <p className={styles.hint}>{uiText("client.scheduledTasks.tasksRunWhileRemoteAiIsOpenUsingThisComputer")}</p>
    {error && <Alert type="error" message={remoteErrorText(error)} />}
  </Modal>;
}
