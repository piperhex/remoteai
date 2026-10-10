import { createThemedStyles } from '../theme/styles';
import {  Text, View } from 'react-native';
import type { PreviewProgress } from '../../../../shared/remote-chat/previewProgress';
import { previewProgressText } from '../../../../shared/chat/previewProgress';

export function PreviewTransferProgress({ progress, label, dark = false }: {
  progress?: PreviewProgress; label: string; dark?: boolean;
}) {
  const styles = useStyles();
  const text = previewProgressText(progress);
  const color = dark ? styles.lightText : styles.darkText;
  return <View style={[styles.container, dark && styles.dark]} accessibilityRole="progressbar"
    accessibilityLabel={label} accessibilityLiveRegion="polite"
    accessibilityValue={{ min: 0, max: 100, now: text.percent,
      text: `${text.percentage} · ${text.amount} · ${text.speed}` }}>
    <View style={styles.row}><Text style={[styles.label, color]}>{label}</Text>
      <Text style={[styles.percent, color]}>{text.percentage}</Text></View>
    <View style={styles.track}>{text.percent !== undefined && <View
      style={[styles.fill, { width: `${text.percent}%` }]} />}</View>
    <View style={[styles.row, styles.detailRow]}><Text style={[styles.detail, color]}>{text.amount}</Text>
      <Text style={[styles.detail, color]}>{text.speed}</Text></View>
  </View>;
}

const useStyles = createThemedStyles((color) => ({
  container: { width: 288, maxWidth: '100%', alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 12, backgroundColor: color('#f0f3f2', 'canvas') },
  dark: { backgroundColor: '#252827' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  label: { fontSize: 13, flexShrink: 1 },
  percent: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  detailRow: { flexWrap: 'wrap', rowGap: 2 },
  detail: { fontSize: 12, opacity: 0.8, fontVariant: ['tabular-nums'] },
  lightText: { color: '#eee' }, darkText: { color: color('#46504c', 'ink') },
  track: { height: 3, marginVertical: 6, borderRadius: 2, backgroundColor: '#8d969333', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#43b99a' },
}));
