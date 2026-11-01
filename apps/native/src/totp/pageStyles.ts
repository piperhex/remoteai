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
  listContent: { flexGrow: 1, paddingTop: 8, paddingHorizontal: 18, paddingBottom: 28 },
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
