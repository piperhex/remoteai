import { createThemedStyles } from '../theme/styles';
import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { palette, useStyles } from './styles';

const DOT_INTERVAL_MS = 400;
const DOTS = ['.', '..', '...'];
const MILLISECONDS_PER_SECOND = 1000;

export function ChatReconnectButton({ retryAt, onPress }: { retryAt: number | null; onPress: () => void }) {
  const reconnectStyles = useReconnectStyles();
  const styles = useStyles();
  useLanguage();
  const [tick, setTick] = useState({ now: Date.now(), dots: 0 });
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => ({ now: Date.now(), dots: (value.dots + 1) % DOTS.length })),
      DOT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
  const seconds = retryAt === null ? null : Math.max(0, Math.ceil((retryAt - tick.now) / MILLISECONDS_PER_SECOND));
  return <Pressable accessibilityRole="button" accessibilityLabel={t("立即连接")} onPress={onPress}
    style={reconnectStyles.button} hitSlop={6}>
    <Text style={[styles.headerMeta, reconnectStyles.text, reconnectStyles.label]}>
      {t("立即连接")}{seconds === null ? '' : t("（{value1}秒）", { value1: seconds })}</Text>
    <Text numberOfLines={1} style={[styles.headerMeta, reconnectStyles.text, reconnectStyles.dots]}>
      {DOTS[tick.dots]}</Text>
  </Pressable>;
}

const useReconnectStyles = createThemedStyles((color) => ({
  // Use the available row width; Android's fallback font can exceed the intrinsic text measurement.
  button: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start' },
  text: { color: color(palette.green, 'accent') },
  label: { flexShrink: 1 },
  dots: { minWidth: 16, flexShrink: 0 },
}));
