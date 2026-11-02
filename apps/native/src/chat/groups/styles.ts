import { createThemedStyles } from '../../theme/styles';
import { textMetrics } from '../../theme/text';
import { palette } from '../styles';

export const useGroupStyles = createThemedStyles(color => ({
  body: { gap: 12, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  text: { ...textMetrics(14, 22), color: color(palette.ink, 'ink'), flexShrink: 1 },
  muted: { ...textMetrics(12, 18), color: color(palette.muted, 'muted'), flexShrink: 1 },
  error: { ...textMetrics(14, 22), color: color(palette.danger, 'danger'), flexShrink: 1 },
  action: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: color(palette.border, 'border'), justifyContent: 'center' },
  input: { ...textMetrics(15, 22), color: color(palette.ink, 'ink'), borderWidth: 1,
    borderColor: color(palette.border, 'border'), borderRadius: 8, padding: 10 },
  card: { borderWidth: 1, borderColor: color(palette.border, 'border'), borderRadius: 12, padding: 14, gap: 10 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  more: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    marginVertical: -8, marginRight: -8 },
  cardTitle: { ...textMetrics(15, 23), color: color(palette.ink, 'ink'), fontWeight: '600', flex: 1, minWidth: 0 },
  details: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  selected: { backgroundColor: color('#e6f8f1', 'canvas') },
}));
