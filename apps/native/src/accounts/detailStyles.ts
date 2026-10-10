import { createThemedStyles } from '../theme/styles';
import { StyleSheet } from 'react-native';

export const detailColors = {
  ink: '#111827', muted: '#738091', border: '#e6ebef', green: '#00aa96', blue: '#409fff',
  mint: '#e0f8f3', panel: '#fcfdfd', danger: '#d95454', warning: '#cc9137',
};

export const useDetailStyles = createThemedStyles((color) => ({
  content: { paddingBottom: 20, gap: 12 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    borderRadius: 14, backgroundColor: color('#f0f8f8', 'canvas'),
  },
  avatar: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: color('#d9f6f0', 'accentSoft'),
    alignItems: 'center', justifyContent: 'center',
  },
  initials: { color: color(detailColors.green, 'accent'), fontSize: 22, fontWeight: '800' },
  identity: { flex: 1, minWidth: 0, gap: 5 },
  email: { color: color(detailColors.ink, 'ink'), fontSize: 16, fontWeight: '700' },
  status: { color: color(detailColors.muted, 'muted'), fontSize: 11, lineHeight: 17 },
  badge: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: color(detailColors.mint, 'accentSoft'), paddingHorizontal: 10 },
  plan: { color: color('#009b80', 'accent'), fontSize: 12, fontWeight: '700', lineHeight: 22 },
  refresh: { alignItems: 'center', gap: 4 },
  refreshCircle: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: color('#bfede5', 'border'),
    backgroundColor: color('#e1f8f3', 'accentSoft'), alignItems: 'center', justifyContent: 'center',
  },
  refreshCaption: { color: color(detailColors.muted, 'muted'), fontSize: 10 },
  section: {
    borderWidth: 1, borderColor: color(detailColors.border, 'border'), borderRadius: 14,
    backgroundColor: color(detailColors.panel, 'surface'), padding: 12,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  sectionIcon: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: color('#edf1f4', 'canvas'),
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: color(detailColors.ink, 'ink'), fontSize: 15, fontWeight: '700', flex: 1 },
  iconButton: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  updated: { color: color(detailColors.muted, 'muted'), fontSize: 10, flexShrink: 1, textAlign: 'right', maxWidth: 148 },
  meter: { marginTop: 9, marginBottom: 8 },
  meterHeading: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  meterTitle: { color: color(detailColors.ink, 'ink'), fontSize: 13, fontWeight: '700' },
  remaining: { fontSize: 19, fontWeight: '700' },
  remainingUnit: { color: color(detailColors.muted, 'muted'), fontSize: 11 },
  spacer: { flex: 1 },
  track: { height: 8, borderRadius: 5, backgroundColor: color('#eaf0f1', 'elevated'), overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
  reset: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  resetText: { flex: 1, color: color(detailColors.muted, 'muted'), fontSize: 11, lineHeight: 17 },
  error: { color: color(detailColors.danger, 'danger'), fontSize: 12, lineHeight: 18, marginTop: 5 },
  row: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color(detailColors.border, 'border'), paddingVertical: 5,
  },
  label: { width: 78, color: color(detailColors.muted, 'muted'), fontSize: 12 },
  value: { flex: 1, color: color(detailColors.ink, 'ink'), fontSize: 12, lineHeight: 19 },
  emptyValue: { color: color(detailColors.muted, 'muted') },
  codeButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  emptyCode: { color: color(detailColors.muted, 'muted'), fontSize: 12 },
  code: { color: color(detailColors.green, 'accent'), fontWeight: '700', fontSize: 17, letterSpacing: 2 },
  countdown: { color: color(detailColors.muted, 'muted'), fontSize: 10 },
  note: { color: color(detailColors.ink, 'ink'), fontSize: 14, lineHeight: 23, maxWidth: 400 },
  messageContent: { paddingBottom: 20, alignSelf: 'center', width: '100%', maxWidth: 440 },
  switchButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: 48, borderRadius: 12, backgroundColor: color(detailColors.mint, 'accentSoft'), paddingHorizontal: 14,
  },
  switchText: { color: color(detailColors.green, 'accent'), fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
}));
