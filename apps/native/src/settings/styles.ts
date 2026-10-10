import { createThemedStyles } from '../theme/styles';
import { StyleSheet } from 'react-native';

export const settingsColors = {
  ink: '#101425', muted: '#7d8496', border: '#eef0f3', canvas: '#f5f6f8',
  green: '#00c98b', blue: '#008cff', orange: '#ff9900', danger: '#f0182c',
};

// Leave room for Android font descenders and fallback glyphs inside the text view.
const textInsets = { includeFontPadding: true, paddingVertical: 2 };

export const useStyles = createThemedStyles((color) => ({
  page: { flex: 1, backgroundColor: color(settingsColors.canvas, 'canvas') },
  scroll: { flexGrow: 1 },
  group: { backgroundColor: color('#fff', 'surface'), marginBottom: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 24, gap: 18 },
  avatar: {
    width: 56, height: 56, borderRadius: 12, backgroundColor: color('#c6f8ef', 'accentSoft'),
    alignItems: 'center', justifyContent: 'center',
  },
  avatarCenter: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: color('#9df0df', 'accentSoft'),
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...textInsets, color: color('#00392f', 'accent'), fontSize: 18, lineHeight: 26, fontWeight: '600' },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { ...textInsets, color: color(settingsColors.ink, 'ink'), fontSize: 19, lineHeight: 28, fontWeight: '700' },
  caption: { ...textInsets, color: color(settingsColors.muted, 'muted'), fontSize: 14, lineHeight: 22, marginTop: 5 },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 22, gap: 15, minHeight: 56 },
  icon: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowContent: {
    flex: 1, minWidth: 0, minHeight: 56, flexDirection: 'row', alignItems: 'center',
    gap: 10, paddingRight: 22, paddingVertical: 14,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color(settingsColors.border, 'border') },
  profileDivider: { height: StyleSheet.hairlineWidth, backgroundColor: color(settingsColors.border, 'border'), marginLeft: 96 },
  label: {
    ...textInsets, color: color(settingsColors.ink, 'ink'), fontSize: 16, lineHeight: 24, flexShrink: 1, maxWidth: '65%',
  },
  value: {
    ...textInsets, color: color(settingsColors.muted, 'muted'), fontSize: 15, lineHeight: 23,
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
  logoutText: { ...textInsets, color: color(settingsColors.danger, 'danger'), fontSize: 17, lineHeight: 26, fontWeight: '600' },
  sheetBody: { width: '100%', maxWidth: 400, alignSelf: 'center', gap: 12, paddingVertical: 8 },
  themeOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  hint: { color: color(settingsColors.muted, 'muted'), fontSize: 14, lineHeight: 21 },
  error: { color: color(settingsColors.danger, 'danger'), fontSize: 14, lineHeight: 21 },
  detailLabel: { ...textInsets, color: color(settingsColors.ink, 'ink'), fontSize: 15, lineHeight: 23, fontWeight: '600' },
  detailValue: { color: color(settingsColors.muted, 'muted'), fontSize: 15, lineHeight: 23 },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: color('#dce2e6', 'border'), borderRadius: 10,
    paddingHorizontal: 14, color: color(settingsColors.ink, 'ink'), fontSize: 16, backgroundColor: color('#fafbfc', 'surface'),
  },
}));
