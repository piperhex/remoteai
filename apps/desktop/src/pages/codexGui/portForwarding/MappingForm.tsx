import { displayError } from '../../../../../../shared/localization/uiText';
import { useState, type FormEvent } from 'react';
import { Button, Input, InputNumber, Radio } from 'antd';
import { ArrowRight } from 'lucide-react';
import { guiLocale, uiText as t } from "../../../../../../shared/localization/uiText";
import { MAX_PORT } from './settings';
import type { MappingProtocol } from '../../../../../../shared/port-mapping/settings';
import { DEFAULT_MAPPING_HOST, EXAMPLE_MAPPING_DOMAIN, localMappingAddress, mappingAddress,
  normalizeMappingDomain } from '../../../../../../shared/port-mapping/target';
import type { ForwardingEntry, PortForwardingService } from './service';
import styles from './portForwarding.module.less';

interface MappingFormProps {
  formId: string;
  service: PortForwardingService;
  entry?: ForwardingEntry;
  connected: boolean;
  saveOnly?: boolean;
  done: () => void;
  saving: boolean;
  setSaving: (saving: boolean) => void;
}

function useMappingForm({ service, entry, done, saving, setSaving, saveOnly, connected }: MappingFormProps) {
  const [remoteHost, setRemoteHost] = useState(entry?.remoteHost ?? '');
  const [localDomain, setLocalDomain] = useState(entry?.localDomain ?? '');
  const [protocol, setProtocol] = useState<MappingProtocol>(entry?.protocol ?? 'tcp');
  const [remotePort, setRemotePort] = useState<number | null>(entry?.remotePort ?? null);
  const [localPort, setLocalPort] = useState<number | null>(entry?.localPort ?? null);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const target = { remoteHost, remotePort: remotePort ?? 0, localPort: localPort ?? remotePort ?? 0,
        protocol, localDomain };
      if (entry) await service.edit(entry.id, target);
      else {
        const id = service.save(target);
        if (!saveOnly && connected) void service.start(id);
      }
      done();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'client.portMappingEditing.couldNotSaveTheMappingPleaseTryAgain');
    }
    finally { setSaving(false); }
  };
  return { remoteHost, setRemoteHost, protocol, setProtocol, remotePort, setRemotePort,
    localPort, setLocalPort, localDomain, setLocalDomain, error, submit };
}

export function MappingForm(props: MappingFormProps) {
  const { entry, saving, formId } = props;
  const form = useMappingForm(props);
  return <form id={formId} className={props.saveOnly ? styles.compactForm : styles.form} onSubmit={form.submit}>
    <div className={styles.field}>
      {props.saveOnly && <span className={styles.label}>{t('client.mappingEditor.protocolType')}</span>}
      <Radio.Group className={styles.protocols} aria-label={t("client.portMappingEditing.transportProtocol")} value={form.protocol}
        disabled={saving} onChange={event => form.setProtocol(event.target.value as MappingProtocol)}>
        <Radio.Button value="tcp">TCP</Radio.Button><Radio.Button value="udp">UDP</Radio.Button>
        <Radio.Button value="both">TCP + UDP</Radio.Button>
      </Radio.Group>
    </div>
    <div className={styles.field}>
      <label className={styles.label} htmlFor="mapping-host">{t("client.portForwarding.targetIp")}<span>{t("client.portMappingEditing.optional")}</span></label>
      <Input id="mapping-host" aria-label={t("client.portForwarding.targetIp")}
        value={form.remoteHost} onChange={event => form.setRemoteHost(event.target.value)}
        placeholder={DEFAULT_MAPPING_HOST} disabled={saving} autoComplete="off" spellCheck={false} autoFocus />
    </div>
    <div className={styles.fields}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="mapping-remote-port">{t("client.portForwarding.remotePort")}</label>
        <InputNumber id="mapping-remote-port" aria-label={t("client.portForwarding.remotePort")} min={1} max={MAX_PORT}
          value={form.remotePort} onChange={form.setRemotePort} placeholder="3000" disabled={saving} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="mapping-local-port">{t("client.portForwarding.localPort")}<span>{t("client.portMappingEditing.optional")}</span></label>
        <InputNumber id="mapping-local-port" aria-label={t("client.portForwarding.localPort")}
          min={1} max={MAX_PORT} value={form.localPort} onChange={form.setLocalPort}
          placeholder={t("client.portMappingEditing.sameAsRemotePort")} disabled={saving} />
      </div>
    </div>
    <div className={styles.field}>
      <label className={styles.label} htmlFor={`${formId}-domain`}>{t('client.mappingEditor.localDomain')}
        <span>{t('client.portMappingEditing.optional')}</span></label>
      <Input id={`${formId}-domain`} aria-describedby={`${formId}-domain-hint`} value={form.localDomain}
        onChange={event => form.setLocalDomain(event.target.value)} placeholder={EXAMPLE_MAPPING_DOMAIN}
        disabled={saving} autoComplete="off" spellCheck={false} />
      <p className={styles.hint} id={`${formId}-domain-hint`}>{t('client.mappingEditor.localDomainHelp')}</p>
    </div>
    {entry && <MappingPreview remoteHost={form.remoteHost} remotePort={form.remotePort} localDomain={form.localDomain}
      localPort={form.localPort} updatedAt={entry.updatedAt} />}
    {form.error && <div className={styles.error} role="alert">{displayError(form.error)}</div>}
  </form>;
}

export function MappingFormActions({ formId, entry, connected, done, saving }:
  Pick<MappingFormProps, 'formId' | 'entry' | 'connected' | 'done' | 'saving'>) {
  return <div className={styles.formActions}>
    <Button onClick={done} disabled={saving} aria-label={t("client.accounts.cancel")}>{t("client.accounts.cancel")}</Button>
    <Button form={formId} htmlType="submit" type="primary" className={styles.primary} loading={saving}>
      {t(entry ? "client.portMappingEditing.saveChanges" : connected ? "client.portForwarding.addAndStart" : "client.portMappingEditing.addMapping")}</Button>
  </div>;
}

function MappingPreview({ remoteHost, remotePort, localPort, localDomain, updatedAt }: {
  remoteHost: string; remotePort: number | null; localPort: number | null; localDomain: string; updatedAt?: number;
}) {
  let target = '—';
  let access = '—';
  const port = localPort ?? remotePort;
  try {
    if (remotePort) target = mappingAddress({ remoteHost, remotePort });
  } catch { /* Keep the draft editable; submission reports invalid IP addresses. */ }
  try {
    if (port) access = localMappingAddress({ localDomain: normalizeMappingDomain(localDomain), localPort: port });
  } catch { /* Submission reports invalid domains. */ }
  return <div className={styles.previewSection}>
    <div className={styles.preview}>
      <span>{t("client.portMappingEditing.localAccess")} → {t("client.portMappingEditing.remoteTarget")}</span>
      <div><code>{access}</code><ArrowRight size={18} aria-hidden="true" />
        <code>{target}</code></div>
    </div>
    {updatedAt && <p className={styles.hint}>
      {t("client.portMappingEditing.lastEdited")} · {new Date(updatedAt).toLocaleString(guiLocale())}
    </p>}
  </div>;
}
