import { displayError, displayText } from '../../../../../../shared/localization/uiText';
import { useEffect, useId, useState } from 'react';
import { Alert, Button, ConfigProvider, Modal } from 'antd';
import { ArrowLeft, Cable, Check, Cloud, CloudUpload, LockKeyhole, Plus, X } from 'lucide-react';
import { uiText as t } from "../../../../../../shared/localization/uiText";
import { usePortForwarding } from './usePortForwarding';
import { MappingForm, MappingFormActions } from './MappingForm';
import { MappingList } from './MappingList';
import { MAX_PORT_MAPPINGS } from './settings';
import type { ForwardingClient, ForwardingEntry } from './service';
import launcherStyles from '../../../../../../shared/conversation/GuiRemoteDesktop.module.less';
import styles from './portForwarding.module.less';

type MappingView = { type: 'list' } | { type: 'create' } | { type: 'edit'; entry: ForwardingEntry };
const MAPPING_ACCENT = '#07838c';
const VIEW_TITLES = { list: "client.portForwarding.portMapping", create: "client.portMappingEditing.newMapping", edit: "client.portMappingEditing.editMapping" } as const;

export function PortForwarding(props: {
  client: ForwardingClient; scope: string; connected: boolean; active: boolean;
}) {
  const { entries, service, syncStatus } = usePortForwarding(props);
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
    <ConfigProvider theme={{ token: { colorPrimary: MAPPING_ACCENT } }}>
      <Modal open={open && props.active} centered width={720} className={styles.dialog} destroyOnHidden
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
