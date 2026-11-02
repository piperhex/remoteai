import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { GroupingUI } from '../../../../../shared/chat/groups/context';
import { groupPath, memberGroup, type GroupMember } from '../../../../../shared/chat/groups/model';
import { t } from '../../i18n';
import { GroupChoice } from './GroupChoice';
import { useGroupStyles } from './styles';

const MEMBER_PAGE_SIZE = 40;

export function GroupMembers({ model }: { model: GroupingUI }) {
  const styles = useGroupStyles();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [limit, setLimit] = useState(MEMBER_PAGE_SIZE);
  const rows = model.members.filter(member => `${member.title} ${member.cwd}`
    .toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const key = (row: GroupMember) => `${row.kind}:${row.id}`;
  const toggle = (id: string) => setSelected(current => current.includes(id)
    ? current.filter(entry => entry !== id) : [...current, id]);
  const apply = async (groupId: string | null) => {
    if (await model.assign(model.members.filter(member => selected.includes(key(member))), groupId)) {
      setSelected([]); setChoosing(false);
    }
  };
  return <View style={styles.body}>
    <TextInput style={styles.input} value={query} onChangeText={value => { setQuery(value); setLimit(MEMBER_PAGE_SIZE); }}
      placeholder={t('client.groups.search')} accessibilityLabel={t('client.groups.search')} />
    <Text style={styles.text}>{t('client.groups.selected', { count: selected.length })}</Text>
    <Pressable accessibilityRole="button" style={styles.action}
      disabled={!selected.length || model.busy || model.loading || !model.ready} onPress={() => setChoosing(true)}>
      <Text style={styles.text}>{t('client.groups.move')}</Text></Pressable>
    <Pressable accessibilityRole="button" style={styles.action} disabled={model.loading} onPress={() => void model.reload()}>
      <Text style={styles.text}>{t('client.workspaceActions.refreshConversations')}</Text></Pressable>
    <ScrollView horizontal><View>
      <View style={styles.line}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={t('client.groups.selectAll')}
          accessibilityState={{ checked: rows.length > 0 && rows.every(row => selected.includes(key(row))) }}
          style={styles.check} disabled={model.busy || model.loading}
          onPress={() => setSelected(rows.every(row => selected.includes(key(row))) ? [] : rows.map(key))}>
          <Feather name={rows.length > 0 && rows.every(row => selected.includes(key(row))) ? 'check-square' : 'square'}
            size={20} /></Pressable>
        <Text style={[styles.text, styles.narrow]}>{t('client.groups.type')}</Text>
        <Text style={[styles.text, styles.cell]}>{t('client.groups.title')}</Text>
        <Text style={[styles.text, styles.cell]}>{t('client.groups.groups')}</Text>
      </View>
      {rows.slice(0, limit).map(row => <View key={key(row)} style={styles.line}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={t('client.groups.select', { name: row.title })}
          accessibilityState={{ checked: selected.includes(key(row)) }} style={styles.check}
          disabled={model.busy || model.loading} onPress={() => toggle(key(row))}>
          <Feather name={selected.includes(key(row)) ? 'check-square' : 'square'} size={20} /></Pressable>
        <Text style={[styles.text, styles.narrow]}>
          {t(row.kind === 'project' ? 'client.groups.project' : 'client.groups.thread')}</Text>
        <View style={styles.cell}><Text style={styles.text}>{row.title}</Text>
          <Text style={styles.muted}>{row.cwd}</Text>
          {row.archived && <Text style={styles.muted}>{t('client.chat.archived')}</Text>}</View>
        <Text style={[styles.text, styles.cell]}>{memberGroup(model.grouping, row)
          ? groupPath(model.grouping.groups, memberGroup(model.grouping, row)!) : t('client.groups.ungrouped')}</Text>
      </View>)}
    </View></ScrollView>
    {rows.length > limit && <Pressable accessibilityRole="button" style={styles.action}
      onPress={() => setLimit(current => current + MEMBER_PAGE_SIZE)}>
      <Text style={styles.text}>{t('client.chat.showMore.83ad87')}</Text></Pressable>}
    {choosing && <GroupChoice groups={model.grouping.groups} title={t('client.groups.move')}
      disabled={model.busy} close={() => setChoosing(false)} pick={id => void apply(id)} />}
  </View>;
}
