import { useId, useState } from 'react';
import { Alert, Button, ConfigProvider, Select, Spin, Tooltip } from 'antd';
import { Cable, LockKeyhole, Monitor, Plus, RefreshCw } from 'lucide-react';
import type { GuiComputer, GuiComputerNavigation } from '../../../../../shared/conversation/remote/types';
import { uiText as t } from '../../../../../shared/localization/uiText';
import { MAX_PORT_MAPPINGS } from '../../../../../shared/port-mapping/settings';
import { MAPPING_COLORS } from '../codexGui/portForwarding/PortForwarding';
import { mappingComputerLabel, mappingComputerOption, renderComputerOption } from './computerOption';
import { MappingDeviceGroup } from './MappingDeviceGroup';
import { MappingEditorDialog, type EditorSelection } from './MappingEditorDialog';
import { useMappingGroups } from './useMappingGroups';
import styles from './page.module.less';

export function PortMappingsPage({ computers }: { computers: GuiComputerNavigation & { mappingDevices: GuiComputer[] } }) {
  const heading = useId();
  const groups = useMappingGroups(computers.mappingDevices);
  const [filter, setFilter] = useState('');
  const [editor, setEditor] = useState<EditorSelection>();
  const selected = groups.find(group => group.device.deviceId === filter);
  const visible = selected ? [selected] : groups;
  const populated = visible.filter(group => group.session.local || group.entries.length > 0);
  const writable = visible.filter(group => group.entries.length < MAX_PORT_MAPPINGS);
  const available = writable.find(group => !group.session.local) ?? writable[0];
  const count = visible.reduce((total, group) => total + group.entries.length, 0);
  const add = () => { if (available) setEditor({ mode: 'new', deviceId: available.device.deviceId }); };
  const refresh = () => { computers.refresh(); visible.forEach(group => group.session.sync.requestRefresh()); };
  const refreshText = t('client.app.refreshDeviceList');

  return <ConfigProvider theme={{ token: MAPPING_COLORS }}><section className={styles.page} aria-labelledby={heading}>
    <header className={styles.header}>
      <span className={styles.heroIcon}><Cable aria-hidden="true" size={27} /></span>
      <div><h1 id={heading}>{t('client.portForwarding.portMapping')}</h1>
        <p>{t('client.portMappingEditing.accessAnIpAndPortThroughTheRemoteComputer')}</p></div>
      <Button type="primary" className={styles.create} icon={<Plus size={16} />} disabled={!available} onClick={add}>
        {t('client.portMappingEditing.newMapping')}</Button>
    </header>
    <div className={styles.toolbar}>
      <h2>{t('client.portMappingEditing.currentMappings')} <span>{count}</span></h2>
      <div className={styles.filters}>
        <Select aria-label={t('client.mappingEditor.chooseDevice')} value={selected?.device.deviceId ?? ''}
          onChange={setFilter} disabled={!groups.length} popupMatchSelectWidth={false} showSearch optionFilterProp="label"
          className={selected ? styles.computerSelect : undefined}
          labelRender={({ label }) => selected ? mappingComputerLabel(selected.device) : label}
          prefix={<Monitor size={14} />} optionRender={renderComputerOption}
          options={[{ value: '', label: t('client.app.allDevices') }, ...groups.map(mappingComputerOption)]} />
        <Tooltip title={refreshText}><Button aria-label={refreshText} icon={<RefreshCw size={15} />}
          disabled={!computers.authenticated || computers.loading} onClick={refresh} /></Tooltip>
      </div>
    </div>
    {computers.error && <Alert type="warning" showIcon message={computers.error} />}
    {populated.map(group => <MappingDeviceGroup key={group.session.scope} group={group} select={setEditor} />)}
    {!populated.length && <div className={styles.empty}>
      {computers.loading && !groups.length ? <Spin /> : <><span className={styles.emptyIcon}><Cable size={26} /></span>
        <h3>{t(!computers.authenticated ? 'client.app.pleaseSignInFirst' : groups.length
          ? 'client.portForwarding.noPortMappingsYet' : 'client.mappingHub.noDevices')}</h3>
        {!computers.authenticated && <Button type="primary" onClick={computers.login}>{t('client.lounge.login')}</Button>}
      </>}
    </div>}
    <footer className={styles.privacy}><LockKeyhole size={14} />{t('client.portMappingEditing.accessibleOnlyOnThisDevice')}</footer>
    {editor && <MappingEditorDialog groups={groups} selection={editor} close={() => setEditor(undefined)} />}
  </section></ConfigProvider>;
}
