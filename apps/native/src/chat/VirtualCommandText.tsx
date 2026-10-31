import { useRef } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { createThemedStyles } from '../theme/styles';
import { textMetrics } from '../theme/text';
import { SelectableChatText } from './SelectableChatText';
import { CopyTextButton } from './CopyTextButton';
import { palette } from './styles';
import { useVirtualText } from '../../../../shared/chat/useVirtualText';
import { chunkDisplayText, TEXT_VIEWPORT_HEIGHT } from '../../../../shared/chat/virtualText';

const FONT_SIZE = 12;
const LINE_HEIGHT = 19;
const COPY_SPACE = 36;
const HORIZONTAL_PADDING = 10;

/** A measured window inside its own scroll view avoids nested FlatList ownership of the outer drawer. */
export function VirtualCommandText({ text, label, command = false, empty = '' }: {
  text: string; label: string; command?: boolean; empty?: string;
}) {
  const styles = useStyles();
  const { fontScale } = useWindowDimensions();
  const content = text || empty;
  const virtual = useVirtualText(content);
  const viewport = useRef({ width: 320, height: TEXT_VIEWPORT_HEIGHT });
  const resize = () => virtual.resize({ ...viewport.current,
    characterWidth: FONT_SIZE * fontScale * 0.65, lineHeight: LINE_HEIGHT * fontScale });
  return <View style={command && styles.command}>
    <ScrollView nestedScrollEnabled style={styles.viewport} testID={command ? 'command-text' : 'command-output'}
      contentContainerStyle={styles.content} scrollEventThrottle={16}
      onLayout={({ nativeEvent: { layout } }) => {
        viewport.current = { width: layout.width - COPY_SPACE - HORIZONTAL_PADDING * 2, height: layout.height };
        resize();
      }} onScroll={({ nativeEvent }) => virtual.scroll(nativeEvent.contentOffset.y)}>
      <View style={{ height: virtual.before }} />
      {virtual.rows.map(chunk => <SelectableChatText key={chunk.start} style={styles.text}
        testID={`virtual-text-${chunk.start}`} onLayout={({ nativeEvent }) => {
          resize();
          virtual.measure(chunk.start, chunk.text, nativeEvent.layout.height);
        }}>{chunkDisplayText(chunk.text)}</SelectableChatText>)}
      <View style={{ height: virtual.after }} />
    </ScrollView>
    {!!text && <View style={styles.copy}><CopyTextButton text={text} label={label} variant="icon" /></View>}
  </View>;
}

const useStyles = createThemedStyles(color => ({
  viewport: { maxHeight: TEXT_VIEWPORT_HEIGHT },
  content: { paddingVertical: 8, paddingLeft: HORIZONTAL_PADDING, paddingRight: COPY_SPACE + HORIZONTAL_PADDING },
  command: { backgroundColor: color('#f4f6f5', 'canvas'), borderRadius: 5 },
  text: { ...textMetrics(FONT_SIZE, LINE_HEIGHT), fontFamily: 'monospace', color: color(palette.ink, 'ink') },
  copy: { position: 'absolute', top: 0, right: 0 },
}));
