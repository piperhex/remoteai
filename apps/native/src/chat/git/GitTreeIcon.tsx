import { useThemeColor } from '../../theme/store';
import { Image, View, type ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useGitStyles as useStyles } from './styles';

const icons: Record<'file' | 'folder', ImageSourcePropType> = {
  file: require('../../../../../shared/remote-chat/assets/git-icons/file-v2.png'),
  folder: require('../../../../../shared/remote-chat/assets/git-icons/folder-v2.png'),
};

export function GitTreeIcon({ folder }: { folder: boolean }) {
  const styles = useStyles();
  return <Image source={icons[folder ? 'folder' : 'file']} style={styles.treeIcon}
    resizeMode="contain" resizeMethod="resize" accessible={false} />;
}

export function GitSelectionMark({ checked, disabled }: { checked: boolean | 'mixed'; disabled?: boolean }) {
  const styles = useStyles();
  const color = useThemeColor();
  return <View style={[styles.check, checked !== false && styles.checked, disabled && styles.disabled]}>
    {checked !== false && <Ionicons name={checked === 'mixed' ? 'remove' : 'checkmark'} size={12} color={color("#25836c", 'accent')} />}
  </View>;
}
