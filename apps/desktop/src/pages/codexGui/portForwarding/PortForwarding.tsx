import { displayError, displayText } from '../../../../../../shared/localization/uiText';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Alert, Button, ConfigProvider, Modal } from 'antd';
import { ArrowLeft, Cable, Check, Cloud, CloudUpload, LockKeyhole, Plus, X } from 'lucide-react';
import { uiText as t } from "../../../../../../shared/localization/uiText";
import { usePortForwarding } from './usePortForwarding';
import { useMappingSessions } from '../../portMappings/MappingSessions';
import type { DesktopMappingSession } from '../../portMappings/DesktopMappingSession';
import { mappingSyncScope } from '../../../../../../shared/port-mapping/sync';
import { MappingForm, MappingFormActions } from './MappingForm';
import { MappingList } from './MappingList';
import { MAX_PORT_MAPPINGS } from './settings';
import type { ForwardingClient, ForwardingEntry } from './service';
import launcherStyles from '../../../../../../shared/conversation/GuiRemoteDesktop.module.less';
import styles from './portForwarding.module.less';

type MappingView = { type: 'list' } | { type: 'create' } | { type: 'edit'; entry: ForwardingEntry };
export const MAPPING_COLORS = { colorPrimary: '#07838c', green: '#196b3e', red: '#aa3138' };
const VIEW_TITLES = { list: "client.portForwarding.portMapping", create: "client.portMappingEditing.newMapping", edit: "client.portMappingEditing.editMapping" } as const;

interface LauncherProps {
  client: ForwardingClient; scope: string; connected: boolean; active: boolean;
}

export function PortForwarding(props: LauncherProps) {
  const sessions = useMappingSessions();
  if (!sessions) return <ConversationMappings {...props} />;
  const session = sessions.get(mappingSyncScope(props.scope)?.deviceId ?? '');
  return session?.scope === props.scope ? <SessionMappings {...props} session={session} /> : null;
}

function ConversationMappings(props: LauncherProps) {
  const model = usePortForwarding(props);
  return <MappingDialog {...props} {...model} />;
}

function SessionMappings({ session, ...props }: LauncherProps & { session: DesktopMappingSession }) {
  const entries = useSyncExternalStore(session.service.subscribe, session.service.snapshot);
  const syncStatus = useSyncExternalStore(session.sync.subscribe, session.sync.snapshot);
  return <MappingDialog {...props} entries={entries} service={session.service} syncStatus={syncStatus} />;
}

function MappingDialog(props: ReturnType<typeof usePortForwarding> & {
  connected: boolean; active: boolean;
}) {
  const { entries, service, syncStatus } = props;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MappingView>({ type: 'list' });
  const [saving, setSaving] = useState(false);
  const formId = useId();
  useEffect(() => { setView({ type: 'list' }); setSaving(false); }, [service]);
  useEffect(() => { if (!props.active) setOpen(false); }, [props.active]);
  const back = () => setView({ type: 'list' });
  const close = () => { if (!saving) setOpen(false); };
  const title = VIEW_TITLES[view.type];
  const editing = view.type === 'edit' ? view.entry : undefined;
  const removed = editing && !entries.some(entry => entry.id === editing.id);
  const showForm = view.type !== 'list' && !removed;
  const count = entries.filter(entry => entry.status === 'running').length;
  return <>
    <button type="button" className={launcherStyles.launcher} aria-label={t("client.portForwarding.portMapping")}
      aria-expanded={open} aria-haspopup="dialog" onClick={() => { back(); setOpen(true); }}>
      <Cable size={14} aria-hidden="true" /><span>{t("client.portForwarding.portMapping")}</span>
      {count > 0 && <span className={styles.count}>{count}</span>}
    </button>
    <ConfigProvider theme={{ token: MAPPING_COLORS }}>
      <Modal open={open && props.active} centered width={720} destroyOnHidden
        className={view.type === 'list' ? styles.dialog : `${styles.dialog} ${styles.editor}`}
        maskClosable={false} keyboard={!saving} onCancel={close} closable={{ disabled: saving }}
        closeIcon={<X size={20} aria-label={t("client.projectBrowser.close")} />} footer={<>
          {showForm && <MappingFormActions formId={formId} entry={editing}
            connected={props.connected} done={back} saving={saving} />}
          <MappingFooter syncStatus={syncStatus} />
        </>}
        title={<div className={styles.header}>
          {view.type === 'list' ? <span className={styles.headerIcon}><Cable size={24} /></span>
            : <button type="button" className={styles.headerIcon} onClick={back} disabled={saving}
              aria-label={t("client.portMappingEditing.backToMappings")}><ArrowLeft size={24} /></button>}
          <div className={styles.heading}>
            <div className={styles.title}><h2>{displayText(title)}</h2>
              {view.type === 'list' && <>
                <span className={styles.total}>{entries.length} / {MAX_PORT_MAPPINGS}</span>
                {entries.length > 0 && <Button type="primary" className={styles.create}
                  icon={<Plus size={16} aria-hidden="true" />}
                  disabled={entries.length >= MAX_PORT_MAPPINGS}
                  onClick={() => setView({ type: 'create' })}>{t("client.portMappingEditing.newMapping")}</Button>}
              </>}
            </div>
            <p>{t("client.portMappingEditing.accessAnIpAndPortThroughTheRemoteComputer")}</p>
          </div>
        </div>}>
        <section className={styles.panel} data-view={view.type} aria-label={t("client.portForwarding.portMappingSettings")}>
          {!props.connected && <Alert type="info" message={t("client.portForwarding.disconnectedReconnectToStartMappingAgain")} />}
          {view.type === 'list' && <MappingList entries={entries} service={service} connected={props.connected}
            create={() => setView({ type: 'create' })} edit={entry => setView({ type: 'edit', entry })} onOpen={close} />}
          {removed && <Alert type="info" message={t("client.portMappingEditing.thisMappingWasRemovedAddItAgainToContinue")}
            action={<Button onClick={back}>{t("client.portMappingEditing.backToMappings")}</Button>} />}
          {showForm && <MappingForm key={editing?.id ?? 'create'} formId={formId}
            service={service} entry={editing} done={back}
            connected={props.connected} saving={saving} setSaving={setSaving} />}
        </section>
      </Modal>
    </ConfigProvider>
  </>;
}

function MappingFooter({ syncStatus }: { syncStatus: string }) {
  const synced = syncStatus === '配置已自动同步';
  return <div className={styles.footer}>
    {syncStatus && <span className={styles.sync} role="status" data-synced={synced}>
      {synced ? <span className={styles.cloudIcon} aria-hidden="true"><Cloud size={20} /><Check size={11} /></span>
        : <CloudUpload size={19} aria-hidden="true" />}
      {displayError(syncStatus)}
    </span>}
    <span className={styles.privacy}><LockKeyhole size={18} aria-hidden="true" />{t("client.portMappingEditing.accessibleOnlyOnThisDevice")}</span>
  </div>;
}
