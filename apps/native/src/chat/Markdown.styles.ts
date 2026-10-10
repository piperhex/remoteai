import { createThemedStyles } from '../theme/styles';
import {  type TextStyle } from 'react-native';
import { palette } from './styles';

export const headingStyles: Record<string, TextStyle> = {
  h1: { fontSize: 28, lineHeight: 42, marginTop: 18, marginBottom: 18 },
  h2: { fontSize: 21, lineHeight: 34, marginTop: 17, marginBottom: 17 },
  h3: { fontSize: 17, lineHeight: 28, marginTop: 16, marginBottom: 16 },
  h4: { fontSize: 14, lineHeight: 25, marginTop: 18, marginBottom: 18 },
  h5: { fontSize: 12, lineHeight: 22, marginTop: 20, marginBottom: 20 },
  h6: { fontSize: 10, lineHeight: 18, marginTop: 23, marginBottom: 23 },
};

export const useMarkdownStyles = createThemedStyles((color) => ({
  paragraph: { marginVertical: 10 },
  compact: { marginVertical: 0 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  inlineCode: { backgroundColor: color('#f4f6f5', 'canvas'), borderRadius: 4 },
  link: { color: color(palette.green, 'accent'), textDecorationLine: 'underline' },
  quote: { borderLeftWidth: 3, borderLeftColor: color(palette.border, 'border'), paddingLeft: 16, marginVertical: 10 },
  muted: { color: color(palette.muted, 'muted') },
  process: { color: color(palette.muted, 'muted'), fontSize: 13, lineHeight: 22 },
  list: { marginVertical: 10 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  // Keep the intrinsic text size when a list is measured inside an auto-width message bubble.
  listContent: { flexShrink: 1, minWidth: 0 },
  marker: { minWidth: 16, flexShrink: 0, textAlign: 'right' },
  checkbox: { width: 13, height: 13, borderWidth: 1, borderColor: color(palette.muted, 'muted'),
    borderRadius: 2, marginTop: 6, marginLeft: 3, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: palette.green, borderColor: color(palette.green, 'accent') },
  checkmark: { color: '#fff', fontSize: 10, lineHeight: 12, fontWeight: '700' },
  table: { marginVertical: 10, flexGrow: 0, flexShrink: 0 },
  tableRow: { flexDirection: 'row' },
  cell: { width: 160, paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: 0.5, borderColor: color(palette.border, 'border') },
  rule: { height: 1, backgroundColor: color(palette.border, 'border'), marginVertical: 14 },
}));
