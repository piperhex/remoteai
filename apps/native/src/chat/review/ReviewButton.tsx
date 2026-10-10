import { Pressable, Text } from 'react-native';
import { useReviewStyles as useCss } from './styles';

export function ReviewButton({ label, onPress, disabled = false }: {
  label: string; onPress: () => void; disabled?: boolean;
}) {
  const css = useCss();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    style={[css.action, disabled && css.disabled]} onPress={onPress}>
    <Text style={css.actionText}>{label}</Text>
  </Pressable>;
}
