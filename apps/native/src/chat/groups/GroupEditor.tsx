import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { GroupingUI } from '../../../../../shared/chat/groups/context';
import { groupPath, GROUP_NAME_LIMIT, type ChatGroup } from '../../../../../shared/chat/groups/model';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetScrollView } from '../../components/SheetScrollView';
import { displayError, t } from '../../i18n';
import { GroupChoice, NativeGroupIcon } from './GroupChoice';
import { useGroupStyles } from './styles';
import { pickGroupIcon } from './icon';

export function GroupEditor({ model, group, close }: { model: GroupingUI; group?: ChatGroup; close: () => void }) {
  const styles = useGroupStyles();
  const [name, setName] = useState(group?.name ?? '');
  const [parentId, setParentId] = useState<string | null>(group?.parentId ?? null);
  const [icon, setIcon] = useState(group?.icon);
  const [choosing, setChoosing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const save = async () => {
    const fields = { name, parentId, icon };
    if (await model.run(group ? { action: 'edit', id: group.id, ...fields }
      : { action: 'create', group: { id: randomUUID(), ...fields } })) close();
  };
  const upload = async () => {
    setUploading(true);
    try { const source = await pickGroupIcon(); if (source) setIcon(source); model.setError(''); }
    catch { model.setError('client.groups.iconError'); }
    finally { setUploading(false); }
  };
  return <BottomSheet visible fullWidthContent title={t(group ? 'client.groups.edit' : 'client.groups.create')}
    dismissible={!model.busy && !uploading} onClose={close} maxWidth={400} actions={[
      { label: t('client.accounts.cancel'), onPress: close, disabled: model.busy || uploading },
      { label: t('client.projectBrowser.save'), onPress: save, loading: model.busy,
        disabled: !name.trim() || uploading || !model.ready },
    ]}>
    <SheetScrollView><View style={styles.body}>
      <Text style={styles.text}>{t('client.groups.name')}</Text>
      <TextInput accessibilityLabel={t('client.groups.name')} style={styles.input} value={name}
        onChangeText={setName} maxLength={GROUP_NAME_LIMIT} editable={!model.busy} autoFocus />
      <Text style={styles.text}>{t('client.groups.parent')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('client.groups.parent')}
        style={styles.action} disabled={model.busy} onPress={() => setChoosing(true)}>
        <Text style={styles.text}>{parentId ? groupPath(model.grouping.groups, parentId) : t('client.groups.root')}</Text>
      </Pressable>
      <View style={styles.row}><NativeGroupIcon icon={icon} size={40} />
        <Pressable accessibilityRole="button" style={styles.action} disabled={model.busy || uploading}
          onPress={() => void upload()}><Text style={styles.text}>{t('client.groups.upload')}</Text></Pressable>
      </View>
      {icon && <Pressable accessibilityRole="button" style={styles.action} disabled={model.busy}
        onPress={() => setIcon(undefined)}><Text style={styles.text}>{t('client.groups.resetIcon')}</Text></Pressable>}
      <Text style={styles.muted}>{t('client.groups.iconHint')}</Text>
      {!!model.error && <Text accessibilityRole="alert" style={styles.error}>{displayError(model.error)}</Text>}
    </View></SheetScrollView>
    {choosing && <GroupChoice parent groups={model.grouping.groups} exclude={group?.id} title={t('client.groups.parent')}
      close={() => setChoosing(false)} pick={id => { setParentId(id); setChoosing(false); }} />}
  </BottomSheet>;
}
