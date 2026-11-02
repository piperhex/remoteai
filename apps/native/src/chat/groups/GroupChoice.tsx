import { Image, Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetScrollView } from '../../components/SheetScrollView';
import { t } from '../../i18n';
import type { ChatGroup } from '../../../../../shared/chat/groups/model';
import { groupOptions } from '../../../../../shared/chat/groups/model';
import { useGroupStyles } from './styles';

export function NativeGroupIcon({ icon, size = 18 }: { icon?: string; size?: number }) {
  const styles = useGroupStyles();
  return icon ? <Image source={{ uri: icon }} style={{ width: size, height: size, borderRadius: 4 }} />
    : <Feather name="layers" size={size} color={styles.text.color} />;
}

export function GroupChoice({ groups, exclude, title, disabled, close, pick, manage, parent = false }: {
  groups: ChatGroup[]; exclude?: string; title: string; disabled?: boolean;
  close: () => void; pick: (id: string | null) => void; manage?: () => void; parent?: boolean;
}) {
  const styles = useGroupStyles();
  return <BottomSheet visible fullWidthContent maxWidth={400} title={title} onClose={close} dismissible={!disabled}>
    <SheetScrollView><View style={styles.body}>
      {groupOptions(groups, exclude).map(group => <Pressable key={group.value} accessibilityRole="button"
        style={styles.row} disabled={disabled} onPress={() => pick(group.value)}>
        <NativeGroupIcon icon={group.icon} /><Text style={styles.text}>{group.label}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" style={styles.action} disabled={disabled} onPress={() => pick(null)}>
        <Text style={styles.text}>{t(parent ? 'client.groups.root' : 'client.groups.ungrouped')}</Text>
      </Pressable>
      {manage && <Pressable accessibilityRole="button" style={styles.action} disabled={disabled} onPress={manage}>
        <Text style={styles.text}>{t('client.groups.manage')}</Text>
      </Pressable>}
    </View></SheetScrollView>
  </BottomSheet>;
}
