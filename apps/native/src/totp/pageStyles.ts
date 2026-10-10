import { createThemedStyles } from '../theme/styles';

export const totpColors = {
  background: '#f3faf7',
  ink: '#101827',
  muted: '#8c94a2',
  green: '#008956',
  accent: '#2ba47d',
};

export const usePageStyles = createThemedStyles((color) => ({
  page: { flex: 1, backgroundColor: color(totpColors.background, 'canvas') },
  activeTab: {
    minWidth: 58, paddingHorizontal: 13, paddingVertical: 6, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: color('#e6f6ee', 'canvas'),
  },
  tab: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', gap: 2 },
  list: { flex: 1 },
  listContent: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 28 },
  header: { paddingTop: 22, paddingBottom: 16 },
  heading: { minHeight: 90, justifyContent: 'center', paddingBottom: 20 },
  title: { color: color(totpColors.ink, 'ink'), fontSize: 30, lineHeight: 40, fontWeight: '900', paddingRight: 70 },
  subtitle: { color: color('#626b78', 'muted'), fontSize: 12, lineHeight: 20, marginTop: 4, paddingRight: 64 },
  illustration: { position: 'absolute', right: 4, top: 1, width: 74, height: 82, alignItems: 'center' },
  glow: {
    position: 'absolute', width: 116, height: 116, borderRadius: 58,
    backgroundColor: color('#e4f6ee', 'canvas'), top: -20, right: -28,
  },
  flourish: {
    position: 'absolute', width: 92, height: 25, borderRadius: 20,
    backgroundColor: color('#d5f0e5', 'accentSoft'), transform: [{ rotate: '-42deg' }], top: 50, right: -18,
  },
  lock: { position: 'absolute', top: 23 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  addButton: {
    flex: 1, minHeight: 46, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center',
    borderRadius: 13, paddingHorizontal: 10, paddingVertical: 10,
  },
  manualButton: { backgroundColor: color('#fff', 'surface'), borderWidth: 1, borderColor: color('#d6ece3', 'border') },
  scanButton: { backgroundColor: totpColors.accent },
  manualText: { color: color(totpColors.green, 'accent'), fontSize: 15, fontWeight: '700' },
  scanText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  searchBox: {
    flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: color('#e5e9ee', 'border'), borderRadius: 14, backgroundColor: color('#fff', 'surface'), paddingHorizontal: 14,
  },
  searchInput: { flex: 1, minWidth: 0, color: color(totpColors.ink, 'ink'), fontSize: 14, paddingVertical: 11 },
  clearSearch: { minHeight: 40, justifyContent: 'center' },
  sortButton: { width: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  sortActive: { backgroundColor: color('#e0f3ea', 'canvas') },
  pressed: { opacity: 0.7 },
}));
