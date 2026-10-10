import { createThemedStyles } from '../theme/styles';
import Feather from '@expo/vector-icons/Feather';
import { Pressable, Text, View } from 'react-native';
import { composerLabel, type ComposerSettings } from '../../../../shared/remote-chat/composer';
import { requestSpeedSuffix, speedBoltCount } from '../../../../shared/remote-chat/requestSpeed';
import { t } from '../i18n';
import { modelLabelTail } from './modelLabel';
import { useStyles } from './styles';
import type { Model } from './types';

export function ComposerModelButton({ models, selection, compact, onPress }: {
  models: Model[]; selection: ComposerSettings; compact: boolean; onPress: () => void;
}) {
  const styles = useStyles();
  const indicatorStyles = useIndicatorStyles();
  const label = composerLabel(models, selection, t);
  const bolts = speedBoltCount(selection.speed ?? 'normal');
  const { color, fontSize } = styles.composerModelText;
  return <Pressable accessibilityRole="button" style={[styles.composerModel, compact && styles.composerModelCompact]}
    accessibilityLabel={t('{value1}，聊天设置', { value1: label + requestSpeedSuffix(selection.speed, t) })}
    onPress={onPress}>
    {compact ? <Feather name="sliders" size={19} color={color} /> : <>
      <Text numberOfLines={1} ellipsizeMode="head" style={styles.composerModelText}>{modelLabelTail(label)}</Text>
      {bolts > 0 && <View style={indicatorStyles.row} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Text style={[styles.composerModelText, indicatorStyles.separator]}>·</Text>
        {Array.from({ length: bolts }, (_, index) =>
          <Feather key={index} name="zap" size={fontSize} color={color} allowFontScaling />)}
      </View>}
      <Feather name="chevron-down" size={12} color={color} />
    </>}
  </Pressable>;
}

const useIndicatorStyles = createThemedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  separator: { marginRight: 4, flexShrink: 0 },
}));
