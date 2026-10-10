import { memo, useMemo } from 'react';
import { Text } from 'react-native';
import { highlightCode } from './codeHighlight';
import { useThemeColor } from '../theme/store';
import { syntaxColorRoles } from '../../../../shared/theme/syntax';

export { fileLanguage } from './codeHighlight';

/** Render inside a selectable monospace Text so selection and copying keep the original code. */
export const HighlightedCode = memo(function HighlightedCode({ text, language }: { text: string; language: string }) {
  const color = useThemeColor();
  const spans = useMemo(() => highlightCode(text, language), [text, language]);
  return <>{spans.map((span, index) => span.color
    ? <Text key={index} style={{ color: color(span.color, syntaxColorRoles[span.color] ?? 'ink') }}>
      {span.text}</Text> : span.text)}</>;
});
