import { displayText } from '../../../../../../shared/localization/uiText';
import { uiText } from "../../../../../../shared/localization/uiText";
import { remoteErrorText } from "../../../../../../shared/localization/errors";
import { useMemo, useState } from "react";
import { Alert, Button, Dropdown, Input, Modal, Spin } from "antd";
import { Bell, ChevronDown, FileSearch, NotebookPen, Search } from "lucide-react";
import { TaskEditor } from "./TaskEditor";
import { TaskRow, type TaskAction } from "./TaskRow";
import { TASK_SUGGESTIONS } from "./suggestions";
import { TASK_FILTERS, filterTasks, scheduleLabel, taskInput,
  type TaskFilter, type ScheduledTask, type TaskInput } from "./types";
import { useScheduledTasks } from "./useScheduledTasks";
import styles from "./scheduledTasks.module.less";

type EditorState = { id: string | null; input: TaskInput };
const SUGGESTION_ICONS = { briefing: Bell, review: NotebookPen, monitor: FileSearch };

export function ScheduledTasksPage({ active, cwd, onOpenThread }: {
  active: boolean; cwd: string; onOpenThread: (threadId: string) => void;
}) {
  const manager = useScheduledTasks(active);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<ScheduledTask | null>(null);
  const tasks = useMemo(() => filterTasks(manager.tasks, filter, search), [manager.tasks, filter, search]);
  const create = (input?: TaskInput) => setEditor({ id: null, input: input ? { ...input, cwd } : {
    title: "", prompt: "", cwd, schedule: { kind: "weekdays", time: "09:00" },
  } });
  const action = (kind: TaskAction, task: ScheduledTask) => {
    if (kind === "open") { if (task.lastThreadId) onOpenThread(task.lastThreadId); return; }
    if (task.runStatus !== "idle" || manager.busy) return;
    if (kind === "edit") { setEditor({ id: task.id, input: taskInput(task) }); return; }
    if (kind === "delete") { setDeleting(task); return; }
    if (kind === "run") { void manager.mutate({ operation: "runNow", id: task.id }); return; }
    void manager.mutate({ operation: "setStatus", id: task.id,
      status: task.status === "active" ? "paused" : "active" });
  };
  const remove = async () => {
    if (deleting && await manager.mutate({ operation: "delete", id: deleting.id })) setDeleting(null);
  };
  return <section className={styles.page} aria-label={uiText("client.workspaceSettings.scheduledTasks")}>
    <div className={styles.toolbar}><Dropdown trigger={["click"]} overlayStyle={{ maxWidth: 400 }}
      menu={{ items: [{ key: "create", label: uiText("client.scheduledTasks.newTask") }, ...TASK_SUGGESTIONS.map((item, index) =>
        ({ key: String(index), label: item.title }))],
      onClick: ({ key }) => create(key === "create" ? undefined : TASK_SUGGESTIONS[Number(key)]) }}>
      <Button className={styles.create} type="primary">{uiText("client.mobile.create")}<ChevronDown size={16} aria-hidden="true" /></Button>
    </Dropdown></div>
    <div className={styles.content}>
      <h1>{uiText("client.workspaceSettings.scheduledTasks")}</h1><p className={styles.subtitle}>{uiText("client.scheduledTasks.letCodexScheduleTasksSetRemindersOrWatchForUpdates")}</p>
      <Input className={styles.search} prefix={<Search size={20} aria-hidden="true" />} allowClear
        aria-label={uiText("client.scheduledTasks.searchScheduledTasks")} placeholder={uiText("client.scheduledTasks.searchScheduledTasks")} value={search}
        onChange={(event) => setSearch(event.target.value)} />
      <div className={styles.filters} role="group" aria-label={uiText("client.shared.taskStatus")}>
        {TASK_FILTERS.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value}
          className={filter === item.value ? styles.selectedFilter : ""}
          onClick={() => setFilter(item.value)}>{displayText(item.label)}</button>)}
      </div>
      {manager.error && !editor && <Alert type="error" className={styles.error} message={remoteErrorText(manager.error)}
        action={<Button size="small" onClick={() => void manager.refresh()}>{uiText("client.terminal.retry")}</Button>} />}
      <div className={styles.taskList} aria-busy={manager.loading}>
        {manager.loading ? <div className={styles.empty}><Spin size="small" />  {uiText("client.scheduledTasks.loadingTasks")}</div>
          : tasks.map((task) => <TaskRow key={task.id} task={task} busy={manager.busy} onAction={action} />)}
        {!manager.loading && tasks.length === 0 && <p className={styles.empty}>
          {search.trim() ? uiText("client.scheduledTasks.noMatchingTasks") : manager.tasks.length ? uiText("client.scheduledTasks.noTasksWithThisStatus") : uiText("client.scheduledTasks.noScheduledTasksYetTryASuggestionBelow")}
        </p>}
      </div>
      <section className={styles.suggestions} aria-label={uiText("client.scheduledTasks.taskSuggestions")}><h2>{uiText("client.scheduledTasks.suggestions")}</h2>
        {TASK_SUGGESTIONS.map((item) => {
          const Icon = SUGGESTION_ICONS[item.icon];
          return <button key={item.title} type="button" className={styles.suggestion} onClick={() => create(item)}>
            <Icon size={21} className={styles[item.icon]} aria-hidden="true" />
            <span><span className={styles.suggestionTitle}>{item.title}
              <span>{scheduleLabel(item.schedule)}</span></span>
              <span className={styles.description}>{item.description}</span></span>
          </button>;
        })}
      </section>
    </div>
    {editor && <TaskEditor initial={editor.input} editing={Boolean(editor.id)} busy={manager.busy}
      error={manager.error} onClose={() => setEditor(null)}
      onSave={(input) => manager.mutate({ operation: "save", id: editor.id, input: taskInput(input) })} />}
    <Modal open={Boolean(deleting)} centered width={400} title={uiText("client.scheduledTasks.deleteThisTask")} okText={uiText("client.projectBrowser.deleted")} cancelText={uiText("client.accounts.cancel")}
      okButtonProps={{ danger: true }} confirmLoading={manager.busy} onOk={() => void remove()}
      onCancel={() => { if (!manager.busy) setDeleting(null); }}>
      <p>{uiText("client.scheduledTasks.theTaskWillStopRunningItsExistingConversationsWillBe")}</p>
    </Modal>
  </section>;
}
