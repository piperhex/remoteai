import { useId, useState } from 'react';
import { Alert, Button, Input, Modal, Select } from 'antd';
import { MAX_PORT_MAPPINGS } from '../../../../../shared/port-mapping/settings';
import { MAX_MAPPING_ALIAS_LENGTH } from '../../../../../shared/port-mapping/localAliases';
import { displayError, uiText as t } from '../../../../../shared/localization/uiText';
import { MappingForm } from '../codexGui/portForwarding/MappingForm';
import formStyles from '../codexGui/portForwarding/portForwarding.module.less';
import type { MappingSelection } from './MappingDeviceGroup';
import type { MappingGroup } from './useMappingGroups';
import { mappingComputerLabel, mappingComputerOption, renderComputerOption } from './computerOption';
import styles from './page.module.less';

export type EditorSelection = MappingSelection | { mode: 'new'; deviceId: string };

export function MappingEditorDialog({ groups, selection, close }: {
  groups: MappingGroup[]; selection: EditorSelection; close: () => void;
}) {
  const [deviceId, setDeviceId] = useState(selection.deviceId);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const group = groups.find(item => item.device.deviceId === deviceId);
  const entry = selection.mode === 'new' ? undefined : group?.entries.find(item => item.id === selection.entryId);
  const removed = !group || (selection.mode !== 'new' && !entry);
  const full = selection.mode === 'new' && (group?.entries.length ?? 0) >= MAX_PORT_MAPPINGS;
  if (selection.mode === 'rename' && group && entry) {
    return <AliasDialog group={group} entryId={entry.id} close={close} />;
  }
  const title = t(selection.mode === 'new' ? 'client.portMappingEditing.newMapping' : 'client.portMappingEditing.editMapping');
  return <Modal open centered width={480} title={title} className={`${styles.editor} ${formStyles.editor}`}
    onCancel={close} maskClosable={!saving} closable={!saving} keyboard={!saving} footer={<>
      <Button disabled={saving} onClick={close}>{t('client.accounts.cancel')}</Button>
      <Button type="primary" form={formId} htmlType="submit" aria-label={t('client.mappingEditor.save')}
        loading={saving} disabled={full || removed}>
        {t('client.mappingEditor.save')}</Button></>}>
    {removed ? <Alert type="info" message={t('client.portMappingEditing.thisMappingWasRemovedAddItAgainToContinue')} />
      : <><label className={styles.deviceLabel} htmlFor={formId + '-device'}>{t('client.mappingEditor.chooseDevice')}</label>
        <Select id={formId + '-device'} aria-label={t('client.mappingEditor.chooseDevice')} value={deviceId}
          disabled={selection.mode !== 'new' || saving} onChange={setDeviceId} showSearch optionFilterProp="label"
          classNames={{ popup: { root: formStyles.editor } }}
          className={styles.computerSelect} labelRender={() => mappingComputerLabel(group.device)}
          optionRender={renderComputerOption} options={groups.map(mappingComputerOption)} />
        {full && <Alert type="info" message={t('client.portForwarding.youCanAddUpTo8MappingsRemoveOneTo')} />}
        <MappingForm key={deviceId} formId={formId} service={group.session.service} entry={entry} saveOnly
          connected={group.device.online} saving={saving} setSaving={setSaving} done={close} /></>}
  </Modal>;
}

function AliasDialog({ group, entryId, close }: { group: MappingGroup; entryId: string; close: () => void }) {
  const [value, setValue] = useState(() => group.session.aliases.get(entryId));
  const [error, setError] = useState('');
  const save = () => {
    try { group.session.aliases.set(entryId, value); close(); }
    catch (reason) { setError(displayError(reason instanceof Error ? reason.message : 'client.mappingEditor.aliasSaveFailed')); }
  };
  return <Modal open centered width={400} title={t('client.mappingEditor.editAlias')} onCancel={close} onOk={save}
    okButtonProps={{ 'aria-label': t('client.mappingEditor.save') }}
    okText={t('client.mappingEditor.save')} cancelText={t('client.accounts.cancel')}>
    <Input autoFocus aria-label={t('client.mappingEditor.alias')} placeholder={t('client.mappingEditor.alias')}
      maxLength={MAX_MAPPING_ALIAS_LENGTH} value={value} onChange={event => setValue(event.target.value)} onPressEnter={save} />
    {error && <Alert type="error" message={error} />}
  </Modal>;
}
