import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { Text, View } from 'react-native';
import { formatTurnDuration } from '../../../desktop/src/pages/codexGui/turnTiming';
import { palette, useStyles } from './styles';
import type { Item } from './types';
import { VirtualCommandText } from './VirtualCommandText';

export function ChatCommandDetails({ item }: { item: Item }) {
  const commandStyles = useCommandStyles();
  const styles = useStyles();
  useLanguage();
  return <View style={{ gap: 8 }}>
    <View style={commandStyles.toolbar}>
      <Text selectable style={[styles.subtitle, styles.fill]}>{item.cwd}</Text>
      {item.durationMs != null && <Text style={styles.subtitle}>{formatTurnDuration(item.durationMs)}</Text>}
    </View>
    <VirtualCommandText text={item.command ?? ''} label={t('client.chat.copyCommand')} command />
    <VirtualCommandText text={item.aggregatedOutput ?? ''} label={t('client.chat.copyOutput')}
      empty={item.status === 'inProgress' ? t("client.chat.waitingForOutput") : t("client.chat.noTextOutput")} />
    <View style={commandStyles.toolbar}>
      <Text style={[styles.subtitle, styles.fill, item.exitCode !== 0 && commandStyles.failed]}>
        {item.exitCode != null ? t("client.mobile.exitCode", { value1: item.exitCode }) : ''}</Text>
    </View>
  </View>;
}

const useCommandStyles = createThemedStyles((color) => ({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  failed: { color: color(palette.danger, 'danger') },
}));
