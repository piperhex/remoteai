import { createThemedStyles } from '../../theme/styles';
import { palette } from '../styles';

export const useReviewStyles = createThemedStyles((color) => ({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  section: { paddingVertical: 16, borderBottomWidth: 1, borderColor: color(palette.border, 'border'), gap: 12 },
  stack: { gap: 12 },
  notice: { maxWidth: 400, color: color(palette.muted, 'muted'), fontSize: 12, lineHeight: 19 },
  error: { maxWidth: 400, color: color('#a55324', 'warning'), fontSize: 12, lineHeight: 19 },
  action: { minHeight: 40, justifyContent: 'center', alignItems: 'flex-start' },
  actionText: { color: color(palette.green, 'accent'), fontSize: 13, lineHeight: 20 },
  disabled: { opacity: 0.4 },
  confirm: { maxWidth: 400, borderRadius: 10, padding: 12, gap: 12, backgroundColor: color('#f4f6f5', 'canvas') },
  input: { borderWidth: 1, borderColor: color(palette.border, 'border'), borderRadius: 8, padding: 10,
    color: color(palette.ink, 'ink'), fontSize: 14, textAlignVertical: 'top', minHeight: 44 },
  form: { maxWidth: 400, gap: 12 },
  output: { maxHeight: 240, padding: 10, borderRadius: 8, backgroundColor: color('#f4f6f5', 'canvas') },
  code: { color: color(palette.ink, 'ink'), fontSize: 12, lineHeight: 18 },
}));
