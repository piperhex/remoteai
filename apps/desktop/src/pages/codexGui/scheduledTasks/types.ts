import { displayText } from '../../../../../../shared/localization/uiText';
export type Schedule =
  | { kind: "once"; at: number }
  | { kind: "interval"; minutes: number }
  | { kind: "daily" | "weekdays"; time: string }
  | { kind: "weekly"; time: string; weekday: number };

export type TaskStatus = "active" | "paused" | "completed";
export type TaskFilter = "all" | TaskStatus;
export interface TaskInput { title: string; prompt: string; cwd: string; schedule: Schedule }
export interface ScheduledTask extends TaskInput {
  id: string;
  status: TaskStatus;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastThreadId: string | null;
  lastTurnId: string | null;
  runStatus: "idle" | "starting" | "running";
  error: string | null;
}
export type TaskRequest =
  | { operation: "list" }
  | { operation: "save"; id: string | null; input: TaskInput }
  | { operation: "setStatus"; id: string; status: "active" | "paused" }
  | { operation: "delete" | "runNow"; id: string };

export const TASK_FILTERS: { value: TaskFilter; label: string }[] = [
  { value: "all", label: "client.configHelp.all" }, { value: "active", label: "client.settings.on" },
  { value: "paused", label: "client.downloads.paused" }, { value: "completed", label: "client.chat.completed" },
];
export const WEEKDAYS = ["client.interface.message.56451f", "client.interface.message.8621c0", "client.interface.message.23ae0a", "client.interface.message.478911", "client.interface.message.6e5969", "client.interface.message.7bb2f5", "client.interface.message.7e06f3"];

export function scheduleLabel(schedule: Schedule): string {
  switch (schedule.kind) {
    case "once": return new Date(schedule.at).toLocaleString(guiLocale(), { month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false });
    case "interval": return uiText("client.scheduledTasks.everyMinutes", { minutes: schedule.minutes });
    case "daily": return uiText("client.scheduledTasks.dailyAt", { time: schedule.time });
    case "weekdays": return uiText("client.scheduledTasks.weekdaysAt", { time: schedule.time });
    case "weekly": return `${displayText(WEEKDAYS[schedule.weekday])} ${schedule.time}`;
  }
}

export function filterTasks(tasks: ScheduledTask[], filter: TaskFilter, search: string) {
  const query = search.trim().toLocaleLowerCase();
  return tasks.filter((task) => (filter === "all" || task.status === filter)
    && `${task.title}\n${task.prompt}`.toLocaleLowerCase().includes(query));
}

/** Keep persisted execution state out of the editable request boundary. */
export function taskInput({ title, prompt, cwd, schedule }: TaskInput): TaskInput {
  return { title, prompt, cwd, schedule };
}
import { guiLocale, uiText } from "../../../../../../shared/localization/uiText";
