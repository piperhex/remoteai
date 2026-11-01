import { createThemedStyles } from '../theme/styles';
import { StyleSheet } from 'react-native';
import { textMetrics } from '../theme/text';

export const settingsColors = {
  ink: '#101425', muted: '#7d8496', border: '#eef0f3', canvas: '#f5f6f8',
  green: '#00c98b', blue: '#008cff', orange: '#ff9900', danger: '#f0182c',
};

export const useStyles = createThemedStyles((color) => ({
  page: { flex: 1, backgroundColor: color(settingsColors.canvas, 'canvas') },
  scroll: { flexGrow: 1 },
  group: { backgroundColor: color('#fff', 'surface'), marginBottom: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 24, gap: 18 },
  profileDetails: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 56, height: 56, borderRadius: 12, backgroundColor: color('#c6f8ef', 'accentSoft'),
    alignItems: 'center', justifyContent: 'center',
  },
  avatarCenter: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: color('#9df0df', 'accentSoft'),
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...textMetrics(18, 26), color: color('#00392f', 'accent'), fontWeight: '600' },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { ...textMetrics(19, 28), color: color(settingsColors.ink, 'ink'), fontWeight: '700' },
  caption: { ...textMetrics(14, 22), color: color(settingsColors.muted, 'muted'), marginTop: 5 },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 22, gap: 15, minHeight: 56 },
  icon: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowContent: {
    flex: 1, minWidth: 0, minHeight: 56, flexDirection: 'row', alignItems: 'center',
    gap: 10, paddingRight: 22, paddingVertical: 14,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color(settingsColors.border, 'border') },
  label: {
    ...textMetrics(16, 24), color: color(settingsColors.ink, 'ink'), flexShrink: 1, maxWidth: '65%',
  },
  value: {
    ...textMetrics(15, 23), color: color(settingsColors.muted, 'muted'),
    flex: 1, minWidth: 0, textAlign: 'right',
  },
  spacer: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  footer: {
    marginTop: 'auto', paddingHorizontal: 22, paddingTop: 12, paddingBottom: 24,
    backgroundColor: color('#fafafb', 'surface'), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color(settingsColors.border, 'border'),
  },
  logout: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: 10, borderWidth: 1, borderColor: color('#ffd4db', 'border'), backgroundColor: color('#fff2f4', 'canvas'), padding: 10,
  },
  logoutText: { ...textMetrics(17, 26), color: color(settingsColors.danger, 'danger'), fontWeight: '600' },
  sheetBody: { width: '100%', maxWidth: 400, alignSelf: 'center', gap: 12, paddingVertical: 8 },
  themeOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  hint: { ...textMetrics(14, 21), color: color(settingsColors.muted, 'muted') },
  error: { ...textMetrics(14, 21), color: color(settingsColors.danger, 'danger') },
  detailLabel: { ...textMetrics(15, 23), color: color(settingsColors.ink, 'ink'), fontWeight: '600' },
  detailValue: { ...textMetrics(15, 23), color: color(settingsColors.muted, 'muted') },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: color('#dce2e6', 'border'), borderRadius: 10,
    paddingHorizontal: 14, color: color(settingsColors.ink, 'ink'), fontSize: 16, backgroundColor: color('#fafbfc', 'surface'),
  },
}));
