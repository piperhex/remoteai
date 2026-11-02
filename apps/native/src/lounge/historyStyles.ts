import { createLoungeStyles } from './theme';
import { textMetrics } from '../theme/text';

export const HISTORY_MESSAGE_FONT_SIZE = 16;

export const useHistoryStyles = createLoungeStyles(color => ({
  page: { flex: 1, backgroundColor: color('#fff', 'canvas') },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, minHeight: 56 },
  side: { flex: 1, minWidth: 0 },
  back: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 3 },
  backText: { ...textMetrics(14, 22), color: color('#456c96', 'info'), flexShrink: 1 },
  title: { ...textMetrics(18, 26), flexShrink: 1, textAlign: 'center', fontWeight: '600',
    color: color('#202b33', 'ink') },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 16, marginBottom: 10,
    paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: color('#dfe5ec', 'border'),
    backgroundColor: color('#f6f8fa', 'surface') },
  input: { ...textMetrics(16, 24), flex: 1, minWidth: 0, minHeight: 44, color: color('#202b33', 'ink') },
  list: { paddingHorizontal: 16, paddingVertical: 12, flexGrow: 1, justifyContent: 'flex-end' },
  date: { ...textMetrics(12, 18), alignSelf: 'center', marginTop: 6, marginBottom: 18,
    paddingHorizontal: 12, paddingVertical: 3, borderRadius: 14,
    color: color('#7a879a', 'muted'), backgroundColor: color('#f0f3f6', 'elevated') },
  status: { padding: 16, alignItems: 'center', gap: 6 },
  statusText: { ...textMetrics(13, 20), color: color('#7a879a', 'muted'), textAlign: 'center' },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  message: { gap: 10, marginBottom: 20 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  bubble: { borderRadius: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    backgroundColor: color('#eef2f5', 'elevated'), paddingHorizontal: 12, paddingVertical: 9 },
  ownBubble: { backgroundColor: color('#deebf7', 'infoSoft') },
  messageText: { ...textMetrics(HISTORY_MESSAGE_FONT_SIZE, 24) },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  time: { ...textMetrics(11, 17), color: color('#7a879a', 'muted') },
}));
