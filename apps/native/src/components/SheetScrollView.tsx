import { createThemedStyles } from '../theme/styles';
import type { ReactNode } from 'react';
import { FlatList, ScrollView, View, type FlatListProps, type ScrollViewProps,
  type StyleProp, type ViewStyle } from 'react-native';

export const SHEET_HORIZONTAL_PADDING = 20;
export const SHEET_READABLE_WIDTH = 400 + SHEET_HORIZONTAL_PADDING * 2;

/** Keep the viewport at the sheet edge; only its contents receive horizontal padding. */
export function SheetScrollView({ style, contentContainerStyle, ...props }: ScrollViewProps) {
  const sheetScrollStyles = useSheetScrollStyles();
  return <ScrollView showsVerticalScrollIndicator {...props} style={[sheetScrollStyles.viewport, style]}
    contentContainerStyle={[sheetScrollStyles.inset, contentContainerStyle]} />;
}

export function SheetFlatList<Item>({ style, contentContainerStyle, ...props }: FlatListProps<Item>) {
  const sheetScrollStyles = useSheetScrollStyles();
  return <FlatList showsVerticalScrollIndicator {...props} style={[sheetScrollStyles.viewport, style]}
    contentContainerStyle={[sheetScrollStyles.inset, contentContainerStyle]} />;
}

/** Fixed controls retain the same inset as the scrollable content beneath them. */
export function SheetInset({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const sheetScrollStyles = useSheetScrollStyles();
  return <View style={[sheetScrollStyles.inset, style]}>{children}</View>;
}

const useSheetScrollStyles = createThemedStyles(() => ({
  viewport: { flexShrink: 1 },
  inset: { paddingHorizontal: SHEET_HORIZONTAL_PADDING },
}));
