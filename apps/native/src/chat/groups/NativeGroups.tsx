import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { GroupingContext, useGroupingUI, type GroupingUI } from '../../../../../shared/chat/groups/context';
import type { ChatGroup } from '../../../../../shared/chat/groups/model';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetInset, SheetScrollView } from '../../components/SheetScrollView';
import { displayError, t } from '../../i18n';
import { GroupChoice } from './GroupChoice';
import { GroupCards } from './GroupCards';
import { GroupEditor } from './GroupEditor';
import { GroupMembers } from './GroupMembers';
import { useGroupStyles } from './styles';

export function NativeGroups({ children, active = true, ...options }: Parameters<typeof useGroupingUI>[0]
  & { children: ReactNode; active?: boolean }) {
  const model = useGroupingUI(options);
  const styles = useGroupStyles();
  return <GroupingContext.Provider value={model}><>{children}</>
    {active && model.managerOpen && <GroupManager model={model} />}
    {active && model.moveTarget && <GroupChoice groups={model.grouping.groups} title={t('client.groups.move')}
      disabled={model.busy || !model.ready} close={() => model.setMoveTarget(null)} manage={model.openManager}
      pick={id => void model.assign([model.moveTarget!], id)} />}
    {active && !!model.error && !model.managerOpen && <BottomSheet visible title={t('client.groups.manage')}
      maxWidth={400} onClose={() => model.setError('')}>
      <Text accessibilityRole="alert" style={styles.error}>{displayError(model.error)}</Text>
    </BottomSheet>}
  </GroupingContext.Provider>;
}

function GroupManager({ model }: { model: GroupingUI }) {
  const styles = useGroupStyles();
  const [tab, setTab] = useState<'groups' | 'members'>('groups');
  const [editing, setEditing] = useState<ChatGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ChatGroup | null>(null);
  return <BottomSheet visible tall fillHeight fullWidthContent title={t('client.groups.manage')} maxWidth={880}
    dismissible={!model.busy} onClose={() => model.setManagerOpen(false)}>
    <SheetInset><View style={styles.row}>
      {(['groups', 'members'] as const).map(value => <Pressable key={value} accessibilityRole="tab"
        accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)}
        style={[styles.action, tab === value && styles.selected]}>
        <Text style={styles.text}>{t(value === 'groups' ? 'client.groups.groups' : 'client.groups.members')}</Text>
      </Pressable>)}
    </View></SheetInset>
    {!!model.error && !editing && <Text accessibilityRole="alert" style={styles.error}>{displayError(model.error)}</Text>}
    <SheetScrollView key={tab}><View style={styles.body}>
      {tab === 'members' ? <GroupMembers model={model} /> : <>
        <Pressable accessibilityRole="button" style={styles.action} disabled={model.busy || !model.ready}
          onPress={() => setEditing('new')}><Text style={styles.text}>{t('client.groups.create')}</Text></Pressable>
        <GroupCards model={model} edit={setEditing} remove={setDeleting} />
      </>}
    </View></SheetScrollView>
    {editing && <GroupEditor model={model} group={editing === 'new' ? undefined : editing}
      close={() => { setEditing(null); model.setError(''); }} />}
    {deleting && <BottomSheet visible maxWidth={400} title={t('client.groups.deleteTitle', { name: deleting.name })}
      dismissible={!model.busy} onClose={() => setDeleting(null)} actions={[
        { label: t('client.accounts.cancel'), onPress: () => setDeleting(null), disabled: model.busy },
        { label: t('client.groups.delete'), tone: 'danger', loading: model.busy,
          onPress: async () => { if (await model.run({ action: 'delete', id: deleting.id })) setDeleting(null); } },
      ]}><Text style={styles.text}>{t('client.groups.deleteHint')}</Text></BottomSheet>}
  </BottomSheet>;
}
