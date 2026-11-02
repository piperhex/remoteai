import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { Alert, Button, Form, Modal, Popconfirm, theme } from 'antd';
import { ArrowUpRight, PlugZap, Save, ShieldCheck, Terminal, Trash2 } from 'lucide-react';
import type { SshApi } from './ssh';
import type { TerminalInfo } from './types';
import { sshLabel, type SshProfile } from './sshProfiles';
import { newSshValues, useSshConnection, type SshValues } from './useSshConnection';
import { SshConnectionFields } from './SshConnectionFields';
import { SshProfileList } from './SshProfileList';
import { displayText as t } from '../localization/messages';
import { remoteErrorText } from '../localization/errors';
import './ssh-dialog.css';
import { SshHostKeyDialog } from './SshHostKeyDialog';

export function SshConnectionDialog({ api, initial, manage = false, settingsOnly = false,
  projectCwd, close, connected, dispose, changed }: {
  api: SshApi; initial?: SshProfile; manage?: boolean; projectCwd: string; close: () => void;
  settingsOnly?: boolean;
  connected: (info: TerminalInfo) => void; dispose: (id: string) => Promise<void>; changed: () => void;
}) {
  const [form] = Form.useForm<SshValues>();
  const formId = useId();
  const feedback = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  const connection = useSshConnection({ api, initial, projectCwd, close: () => { changed(); close(); },
    connected, dispose, createId: () => crypto.randomUUID() });
  const { profiles, selected, busy, finished, error, trust, loading, tested, action } = connection;
  const disabled = busy || finished || loading;
  const managing = !settingsOnly && (manage || !!initial);
  useEffect(() => { if (finished) form.resetFields(); }, [finished, form]);
  useEffect(() => {
    if (trust || error || tested) feedback.current?.scrollIntoView({ block: 'nearest' });
  }, [trust, error, tested]);
  const authenticate = (operation: 'test' | 'submit') => {
    void form.validateFields().then(values => {
      if (values.auth === 'key' && !connection.canConnect(values)) {
        form.setFields([{ name: 'privateKey', errors: [t('client.ssh.keyRequiredForConnection')] }]);
        form.scrollToField('privateKey', { block: 'center' }); return;
      }
      return connection[operation](values);
    }, () => { /* The form displays validation errors next to the affected fields. */ });
  };
  const choose = (profile?: SshProfile) => {
    form.resetFields();
    form.setFieldsValue(connection.choose(profile));
  };
  const remove = async () => {
    if (await connection.remove()) { form.resetFields(); form.setFieldsValue(newSshValues()); changed(); }
  };
  const colors = {
    '--ssh-surface': token.colorBgElevated, '--ssh-field': token.colorBgContainer,
    '--ssh-subtle': token.colorFillAlter, '--ssh-line': token.colorBorderSecondary,
    '--ssh-text': token.colorText, '--ssh-muted': token.colorTextSecondary, '--ssh-error': token.colorError,
  } as CSSProperties;
  const title = t(settingsOnly && initial ? 'client.ssh.editTitle'
    : managing ? 'client.ssh.manage' : 'client.ssh.createTitle');
  return <Modal open centered title={<div className="ssh-dialog-heading">
    <span className="ssh-dialog-symbol"><Terminal size={24} aria-hidden /></span>
    <span><span className="ssh-dialog-title">{title}</span>
      <span className="ssh-dialog-subtitle">
        {t(settingsOnly ? 'client.ssh.settingsCredentialsHint'
          : managing ? 'client.ssh.manageHint' : 'client.ssh.createHint')}
      </span></span>
  </div>} width={managing ? 860 : 560} onCancel={close} footer={null} style={colors}
    maskClosable={!busy} closable={!busy} keyboard={!busy}
    className={`ssh-dialog${managing ? ' ssh-dialog-manager' : ''}${settingsOnly ? ' ssh-dialog-settings' : ''}`}>
    <div className="ssh-dialog-layout">
      {managing && <SshProfileList profiles={profiles} selected={selected} disabled={disabled}
        loading={loading} choose={choose} />}
      <Form id={formId} form={form} layout="vertical" className="ssh-connection-form"
        onFinish={values => void connection.saveSettings(values)} disabled={disabled}
        initialValues={initial ?? newSshValues()} requiredMark={false} scrollToFirstError={{ block: 'center' }}
        onValuesChange={values => {
          connection.clearTest();
          if ('host' in values || 'port' in values) connection.clearTrust();
        }}>
        <div className="ssh-form-scroll">
          {managing && <div className="ssh-detail-heading">
            <h3>{selected ? selected.name || sshLabel(selected) : t('client.ssh.createTitle')}</h3>
            <span className="ssh-detail-badge">
              {t(selected ? 'client.ssh.savedConnection' : 'client.ssh.newConnection')}
            </span>
          </div>}
          <SshConnectionFields form={form} disabled={disabled} />
          <div className="ssh-credentials-note"><ShieldCheck size={17} aria-hidden />
            <div><p>{t('client.ssh.settingsCredentialsHint')}</p>
              <p>{t('client.ssh.credentialsHint')}</p></div></div>
          {!settingsOnly && <Button className="ssh-test" icon={<PlugZap size={16} />} disabled={disabled}
            loading={action === 'test'} onClick={() => authenticate('test')}>
            {t(trust ? 'client.ssh.trustAndTest' : 'client.ssh.testConnection')}</Button>}
          <div ref={feedback} aria-live="polite">
            {tested && <Alert showIcon type="success" message={t('client.ssh.testSucceeded')} />}
            {trust && !trust.previousFingerprints && <Alert showIcon type="warning" message={t('client.ssh.trustHost')}
              description={<code className="ssh-fingerprint">{trust.fingerprint}</code>} />}
            {error && <Alert showIcon type="error" role="alert" message={remoteErrorText(error)}
              action={<Button size="small" disabled={busy} onClick={() => void connection.refresh()}>
                {t('client.ssh.refresh')}</Button>} />}
          </div>
        </div>
        <div className="ssh-dialog-actions">
          {selected && !settingsOnly && <Popconfirm title={t('client.ssh.removeTitle')}
            description={t('client.ssh.removeHint')} onConfirm={remove} disabled={disabled}
            okText={t('client.ssh.removeSaved')} cancelText={t('client.ssh.cancel')}
            okButtonProps={{ danger: true }} styles={{ root: { maxWidth: 400 } }}>
            <Button className="ssh-remove" type="text" danger disabled={disabled} icon={<Trash2 size={16} />}>
              {t('client.ssh.removeSaved')}</Button>
          </Popconfirm>}
          <div className="ssh-submit-actions">
            <Button aria-label={t('client.ssh.cancel')} disabled={busy} onClick={close}>{t('client.ssh.cancel')}</Button>
            {!finished && <>
              {!settingsOnly && <Button onClick={() => authenticate('submit')} loading={action === 'connect'}
                icon={<ArrowUpRight size={16} />}>
                {t(trust ? 'client.ssh.trustAndConnect' : 'client.ssh.connect')}</Button>}
              <Button aria-label={t('client.ssh.saveSettings')} className="ssh-connect" type="primary" htmlType="submit"
                loading={action === 'save'} icon={<Save size={16} />}>
                {t(connection.preparingX11 ? 'client.ssh.x11Starting' : 'client.ssh.saveSettings')}</Button>
            </>}
          </div>
        </div>
      </Form>
    </div>
    <SshHostKeyDialog trust={trust} busy={busy} confirm={() => { void connection.confirmTrust(); }}
      cancel={connection.clearTrust} />
  </Modal>;
}
