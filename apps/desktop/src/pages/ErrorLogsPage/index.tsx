import { getLocale } from "../../i18n";
import { Alert, Button, Popconfirm, Segmented, Table, Tag, type TableColumnsType } from "antd";
import { RefreshCw, Trash2 } from "lucide-react";
import type { ErrorLogEntry } from "../../api/errorLogs";
import type { Language, Translate } from "../../i18n";
import { useErrorLogs, type ErrorLogFilter } from "./useErrorLogs";
import { ERROR_LOG_RETENTION_LIMIT, LOG_PAGE_SIZE_OPTIONS } from "./pagination";
import styles from "./index.module.less";

interface ErrorLogsPageProps {
  language: Language;
  t: Translate;
}

function logColumns({ language, t }: ErrorLogsPageProps): TableColumnsType<ErrorLogEntry> {
  const sources = { proxy: t("errorLogs.proxy"), toast: t("errorLogs.toast"), codex: "Codex CLI" };
  return [
    {
      title: t("errorLogs.time"), dataIndex: "createdAt", width: 174,
      render: (value: string) => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(getLocale(language));
      },
    },
    {
      title: t("errorLogs.source"), dataIndex: "source", width: 110,
      render: (source: ErrorLogEntry["source"]) => (
        <Tag color={source === "proxy" ? "error" : "default"}>
          {sources[source]}
        </Tag>
      ),
    },
    {
      title: t("errorLogs.message"), dataIndex: "message",
      render: (message: string) => <div className={styles.message}>{message}</div>,
    },
    {
      title: t("errorLogs.status"), dataIndex: "statusCode", width: 96,
      render: (status?: number | null) => status ?? "—",
    },
  ];
}

function LogToolbar({ logs, t }: { logs: ReturnType<typeof useErrorLogs>; t: Translate }) {
  const busy = logs.operation !== null && logs.operation !== "poll";
  return (
    <div className={styles.toolbar}>
      <Segmented<ErrorLogFilter> value={logs.filter} disabled={busy} onChange={logs.setFilter}
        options={[
          { value: "all", label: t("errorLogs.all") },
          { value: "proxy", label: t("errorLogs.proxy") },
          { value: "toast", label: t("errorLogs.toast") },
          { value: "codex", label: "Codex CLI" },
        ]} />
      <div className={styles.actions}>
        <Button size="small" icon={<RefreshCw size={14} />} loading={logs.operation === "refresh"}
          disabled={busy} onClick={logs.refresh}>{t("errorLogs.refresh")}</Button>
        <Popconfirm title={t("errorLogs.clearTitle")} description={t("errorLogs.clearDescription")}
          okText={t("errorLogs.clear")} cancelText={t("errorLogs.cancel")}
          okButtonProps={{ danger: true, disabled: logs.operation !== null }}
          styles={{ root: { maxWidth: 400 }, body: { maxWidth: 400 } }}
          onConfirm={() => logs.clear()} onOpenChange={logs.setPollingPaused} disabled={busy}>
          <Button size="small" danger icon={<Trash2 size={14} />} loading={logs.operation === "clear"}
            disabled={busy}>{t("errorLogs.clear")}</Button>
        </Popconfirm>
      </div>
    </div>
  );
}

export function ErrorLogsPage({ language, t }: ErrorLogsPageProps) {
  const logs = useErrorLogs();
  const busy = logs.operation !== null && logs.operation !== "poll";
  return (
    <section className={styles.page} aria-label={t("errorLogs.title")}>
      <LogToolbar logs={logs} t={t} />
      {logs.error && <Alert type="error" showIcon className={styles.error}
        message={t(logs.error === "clear" ? "errorLogs.clearFailed" : "errorLogs.loadFailed")} />}
      <Table<ErrorLogEntry> className={styles.table} rowKey="id" size="small" tableLayout="fixed"
        columns={logColumns({ language, t })} dataSource={logs.entries} loading={busy}
        pagination={{ current: logs.page, pageSize: logs.pageSize, total: logs.total,
          pageSizeOptions: LOG_PAGE_SIZE_OPTIONS, showSizeChanger: true, size: "small", disabled: busy,
          showTotal: (total) => t("errorLogs.count", { count: total, limit: ERROR_LOG_RETENTION_LIMIT }),
          onChange: logs.changePage }}
        locale={{ emptyText: t("errorLogs.empty") }} scroll={{ x: 700, y: "100%" }} />
    </section>
  );
}
