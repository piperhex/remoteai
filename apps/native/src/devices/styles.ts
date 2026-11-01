import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';

export const deviceColors = {
  canvas: '#f3fbf8', ink: '#111522', muted: '#78818f', green: '#00866b',
  mint: '#e3f8f1', border: '#eaf0ed', danger: '#c64b43', offline: '#99a2ad',
};

export const useStyles = createThemedStyles((color) => ({
  page: { flex: 1, backgroundColor: color(deviceColors.canvas, 'canvas') },
  scroll: { padding: 20, paddingTop: 12, paddingBottom: 32 },
  summary: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  stat: {
    flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: color('#fff', 'surface'),
  },
  statIcon: {
    width: 20, flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  statValue: { ...textMetrics(20, 28), flexShrink: 1, color: color(deviceColors.ink, 'ink'), fontWeight: '700' },
  statLabel: { ...textMetrics(12, 18), flex: 1, color: color(deviceColors.muted, 'muted') },
  card: {
    borderRadius: 18, backgroundColor: color('#fff', 'surface'), padding: 14, marginBottom: 14,
    shadowColor: '#538f7c', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  pressed: { backgroundColor: color('#edf9f4', 'canvas') },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  platform: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: color('#dcf6ed', 'accentSoft'),
    alignItems: 'center', justifyContent: 'center',
  },
  identity: { flex: 1, minWidth: 0 },
  name: { ...textMetrics(16, 24), color: color(deviceColors.ink, 'ink'), fontWeight: '800' },
  meta: { ...textMetrics(12, 18), color: color(deviceColors.muted, 'muted'), marginTop: 5 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10,
    paddingVertical: 7, borderRadius: 20, backgroundColor: color(deviceColors.mint, 'accentSoft'),
  },
  badgeOffline: { backgroundColor: color('#f0f2f4', 'canvas') },
  badgeText: { ...textMetrics(12, 18), color: color(deviceColors.green, 'accent'), fontWeight: '700' },
  muted: { color: color(deviceColors.muted, 'muted') },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00aa7d' },
  dotOffline: { backgroundColor: color(deviceColors.offline, 'border') },
  menuTrigger: {
    position: 'absolute', right: 6, top: 14, width: 36, height: 44,
    alignItems: 'center', justifyContent: 'center', borderRadius: 12,
  },
  topInset: { paddingRight: 28 },
  divider: { height: 1, backgroundColor: color(deviceColors.border, 'border'), marginVertical: 12 },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 29, paddingVertical: 3 },
  detailLabel: { ...textMetrics(12, 20), color: color(deviceColors.muted, 'muted'), width: 72 },
  detailValue: {
    ...textMetrics(12, 20), flex: 1, minWidth: 0, color: color(deviceColors.ink, 'ink'), textAlign: 'right',
  },
  hint: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: color('#e4f6ef', 'canvas'), borderRadius: 14, padding: 15,
  },
  hintText: { ...textMetrics(12, 19), flexShrink: 1, color: color(deviceColors.muted, 'muted') },
  empty: { alignItems: 'center', padding: 32, borderRadius: 18, backgroundColor: color('#fff', 'surface'), gap: 12 },
  emptyTitle: { ...textMetrics(17, 26), color: color(deviceColors.ink, 'ink'), fontWeight: '700' },
  emptyText: { ...textMetrics(13, 21), color: color(deviceColors.muted, 'muted'), textAlign: 'center' },
  optionsContent: { paddingBottom: 12 },
  screenExplanation: { ...textMetrics(14, 23), color: color(deviceColors.muted, 'muted') },
  option: { flexDirection: 'row', alignItems: 'center', minHeight: 52, padding: 10, gap: 12, borderRadius: 12 },
  optionLabel: { ...textMetrics(16, 24), flex: 1, color: color(deviceColors.ink, 'ink') },
  danger: { color: color(deviceColors.danger, 'danger') },
  disabled: { opacity: 0.45 },
}));
