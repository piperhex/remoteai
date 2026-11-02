import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { GroupingUI } from '../../../../../shared/chat/groups/context';
import { groupPath, memberGroup, type ChatGroup, type GroupMember } from '../../../../../shared/chat/groups/model';
import { t } from '../../i18n';
import { NativeGroupIcon } from './GroupChoice';
import { useGroupStyles } from './styles';
import { BottomSheet } from '../../components/BottomSheet';

export function GroupCards({ model, edit, remove }: {
  model: GroupingUI; edit: (group: ChatGroup) => void; remove: (group: ChatGroup) => void;
}) {
  const styles = useGroupStyles();
  const [actions, setActions] = useState<ChatGroup | null>(null);
  return <View style={styles.body}>
    {!model.grouping.groups.length && <Text style={styles.muted}>{t('client.groups.empty')}</Text>}
    {model.grouping.groups.map(group => <View key={group.id} style={styles.card}>
      <View style={styles.cardHeading}><NativeGroupIcon icon={group.icon} size={22} />
        <Text style={styles.cardTitle}>{group.name}</Text>
        <Pressable accessibilityRole="button" style={styles.more} disabled={model.busy || !model.ready}
          accessibilityLabel={t('client.app.moreActionsFor', { value1: group.name })}
          onPress={() => setActions(group)}><Feather name="more-horizontal" size={20} color={styles.text.color} /></Pressable>
      </View>
      <View style={styles.details}><Text style={styles.muted}>{t('client.groups.parent')}</Text>
        <Text style={styles.text}>{group.parentId
          ? groupPath(model.grouping.groups, group.parentId) : t('client.groups.root')}</Text></View>
    </View>)}
    {actions && <BottomSheet visible maxWidth={400} title={actions.name} onClose={() => setActions(null)}>
      <View style={styles.body}>
        <Pressable accessibilityRole="button" style={styles.action} disabled={model.busy || !model.ready}
          onPress={() => { setActions(null); edit(actions); }}>
          <Text style={styles.text}>{t('client.groups.edit')}</Text></Pressable>
        <Pressable accessibilityRole="button" style={styles.action} disabled={model.busy || !model.ready}
          onPress={() => { setActions(null); remove(actions); }}>
          <Text style={styles.error}>{t('client.groups.delete')}</Text></Pressable>
      </View>
    </BottomSheet>}
  </View>;
}

export function GroupMemberCard({ model, member, selected, toggle }: {
  model: GroupingUI; member: GroupMember; selected: boolean; toggle: () => void;
}) {
  const styles = useGroupStyles();
  const id = memberGroup(model.grouping, member);
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={t('client.groups.select', { name: member.title })}
    accessibilityState={{ checked: selected }} disabled={model.busy || model.loading} onPress={toggle}
    style={[styles.card, selected && styles.selected]}>
    <View style={styles.cardHeading}>
      <Feather name={selected ? 'check-square' : 'square'} size={20} color={styles.text.color} />
      <Text style={styles.cardTitle}>{member.title}</Text>
    </View>
    <View style={styles.details}>
      <Text style={styles.muted}>{t(member.kind === 'project' ? 'client.groups.project' : 'client.groups.thread')}</Text>
      {member.archived && <Text style={styles.muted}>{t('client.chat.archived')}</Text>}
    </View>
    <Text style={styles.muted}>{member.cwd}</Text>
    <View style={styles.details}><Text style={styles.muted}>{t('client.groups.groups')}</Text>
      <Text style={styles.text}>{id ? groupPath(model.grouping.groups, id) : t('client.groups.ungrouped')}</Text></View>
  </Pressable>;
}
