import { createThemedStyles } from '../theme/styles';
import { palette } from '../chat/styles';

export const chartColors = ['#0b8065', '#cb8b41', '#7d8eaa', '#304e63', '#87b8a4'];
export const useSummaryStyles = createThemedStyles((color) => ({
  page: { flex: 1, backgroundColor: color(palette.background, 'canvas') },
  content: { padding: 16, paddingBottom: 32, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
    paddingVertical: 8, backgroundColor: color('#fff', 'surface'), borderBottomWidth: 1, borderColor: color(palette.border, 'border') },
  title: { color: color(palette.ink, 'ink'), fontSize: 20, lineHeight: 28, fontWeight: '700' },
  card: { backgroundColor: color('#fff', 'surface'), borderRadius: 16, borderWidth: 1, borderColor: color(palette.border, 'border'),
    padding: 16, gap: 12 },
  sectionTitle: { color: color(palette.ink, 'ink'), fontSize: 16, lineHeight: 24, fontWeight: '700' },
  hint: { color: color(palette.muted, 'muted'), fontSize: 12, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fill: { flex: 1, minWidth: 0 },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 12, borderRadius: 10 },
  chip: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center',
    borderRadius: 10, backgroundColor: color(palette.background, 'canvas') },
  selected: { backgroundColor: color(palette.pale, 'accentSoft') },
  action: { color: color(palette.green, 'accent'), fontSize: 14, lineHeight: 22, fontWeight: '600' },
  value: { color: color(palette.ink, 'ink'), fontSize: 16, lineHeight: 24, fontWeight: '700' },
  number: { color: color(palette.green, 'accent'), fontSize: 30, lineHeight: 40, fontWeight: '700' },
  metric: { minWidth: '40%', flexGrow: 1, gap: 4 },
  barTrack: { height: 7, borderRadius: 4, backgroundColor: color(palette.background, 'canvas'), overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4, backgroundColor: palette.green },
  error: { color: color(palette.danger, 'danger'), fontSize: 13, lineHeight: 20, maxWidth: 400 },
  detail: { padding: 12, borderRadius: 10, backgroundColor: color(palette.background, 'canvas'), gap: 4, maxWidth: 400 },
  input: { minHeight: 44, minWidth: 48, textAlign: 'center', borderRadius: 8,
    borderWidth: 1, borderColor: color(palette.border, 'border'), color: color(palette.ink, 'ink'), fontSize: 16 },
}));
