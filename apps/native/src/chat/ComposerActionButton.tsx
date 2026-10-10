import { createThemedStyles } from '../theme/styles';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { COMPOSER_ACTION_LABELS, type ComposerAction } from '../../../../shared/remote-chat/composerAction';
import { palette, useStyles } from './styles';
import { t, useLanguage } from '../i18n';

interface Props { action: ComposerAction; disabled: boolean; busy: boolean; onPress: () => void }

export function ComposerActionButton({ action, disabled, busy, onPress }: Props) {
  const buttonStyles = useButtonStyles();
  const styles = useStyles();
  useLanguage();
  return <Pressable accessibilityRole="button" accessibilityLabel={t(COMPOSER_ACTION_LABELS[action])}
    accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress}
    style={[buttonStyles.button, disabled && styles.disabled]}>
    {busy ? <ActivityIndicator color="#fff" /> : <View importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden style={buttonStyles.icon}>
      {action === 'pause' && <View style={buttonStyles.pause}>
        <View style={buttonStyles.bar} /><View style={buttonStyles.bar} />
      </View>}
      {action === 'continue' && <View style={buttonStyles.play} />}
      {action === 'send' && <><View style={buttonStyles.arrowHead} /><View style={buttonStyles.arrowStem} /></>}
    </View>}
  </Pressable>;
}

const useButtonStyles = createThemedStyles((color) => ({
  button: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.green,
    alignItems: 'center', justifyContent: 'center' },
  icon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  pause: { flexDirection: 'row', gap: 5 },
  bar: { width: 4, height: 16, borderRadius: 1, backgroundColor: color('#fff', 'surface') },
  play: { marginLeft: 3, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 14,
    borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: color('#fff', 'border') },
  arrowHead: { position: 'absolute', top: 3, width: 11, height: 11, borderTopWidth: 2,
    borderLeftWidth: 2, borderColor: color('#fff', 'border'), transform: [{ rotate: '45deg' }] },
  arrowStem: { position: 'absolute', top: 3, width: 2, height: 16, backgroundColor: color('#fff', 'surface') },
}));
