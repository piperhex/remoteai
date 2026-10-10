import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { themeColor, type ThemeColor } from '../../../../shared/theme/mode';
import { useThemeMode } from './store';

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/** Cache both palettes; subscribing inside each consumer also updates memoized rows and open sheets. */
export function createThemedStyles<T extends NamedStyles<T>>(factory: (color: ThemeColor) => T) {
  const styles = {
    light: StyleSheet.create(factory(themeColor('light'))),
    dark: StyleSheet.create(factory(themeColor('dark'))),
  };
  return function useStyles() { return styles[useThemeMode()]; };
}
