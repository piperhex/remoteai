import { Pressable, ScrollView, Text } from 'react-native';
import { useTerminalStyles as useStyles } from './styles';

const KEYS = [['Ctrl+C', '\x03'], ['Tab', '\t'], ['Esc', '\x1b'], ['↑', '\x1b[A'],
  ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']] as const;

/** Keep shortcuts beside the header in landscape so tall keyboards leave room for output. */
export function TerminalKeys({ input }: { input: (data: string) => void }) {
  const styles = useStyles();
  return <ScrollView horizontal style={styles.inlineKeys} contentContainerStyle={styles.keyItems}
    keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
    {KEYS.map(([label, data]) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label}
      onPress={() => input(data)} style={styles.key}><Text style={styles.tabLabel}>{label}</Text></Pressable>)}
  </ScrollView>;
}
