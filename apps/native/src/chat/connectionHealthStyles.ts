import { createThemedStyles } from '../theme/styles';
import { palette } from './styles';
import type { ThemeColor } from '../../../../shared/theme/mode';

export const healthTones = (color: ThemeColor) => ({
  ok: { color: color('#21883f', 'accent'), background: color('#edf7f0', 'accentSoft') },
  waiting: { color: color('#946617', 'warning'), background: color('#fff7e6', 'warningSoft') },
  blocked: { color: color('#bf4e46', 'danger'), background: color('#fff0ee', 'dangerSoft') },
});
export const stepTones = (color: ThemeColor) => ({
  login: healthTones(color).ok,
  computer: { color: color('#358bd5', 'info'), background: color('#edf5fe', 'infoSoft') },
  path: { color: color('#7960db', 'purple'), background: color('#f0ecfc', 'purpleSoft') },
  chat: { color: color('#d38132', 'warning'), background: color('#fff2e8', 'warningSoft') },
});

export const useHealthStyles = createThemedStyles((color) => ({
  content: { paddingBottom: 24, gap: 12, width: '100%', maxWidth: 400, alignSelf: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16 },
  summaryIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  steps: { gap: 8 },
  addresses: { gap: 12, padding: 12, borderWidth: 1, borderColor: color('#eeeeef', 'border'), borderRadius: 14 },
  addressRow: { gap: 4, minWidth: 0 },
  address: { color: color(palette.ink, 'ink'), fontSize: 12, lineHeight: 19, flexShrink: 1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 68,
    borderWidth: 1, borderColor: color('#eeeeef', 'border'), borderRadius: 14, backgroundColor: color('#fff', 'surface') },
  stepIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  label: { color: color(palette.ink, 'ink'), fontSize: 14, lineHeight: 22, fontWeight: '600' },
  detail: { color: color('#777f84', 'muted'), fontSize: 12, lineHeight: 19, flexShrink: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6,
    borderRadius: 12, flexShrink: 1, maxWidth: '32%' },
  badgeIcon: { width: 13, height: 13, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  wideBadge: { maxWidth: '100%', alignSelf: 'flex-start', marginTop: 2 },
  badgeLabel: { fontSize: 12, lineHeight: 18, fontWeight: '600', flexShrink: 1 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
    marginTop: 12, borderRadius: 16, backgroundColor: color('#f4f6fd', 'canvas') },
  button: { flexDirection: 'row', gap: 8, padding: 12, minHeight: 44,
    backgroundColor: palette.green, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonLabel: { color: '#fff', fontSize: 14, lineHeight: 22, fontWeight: '600' },
  pressed: { opacity: 0.78 },
}));
