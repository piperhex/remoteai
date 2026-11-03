import { StatusBar } from 'expo-status-bar';
import { useThemeMode } from './store';

export function ThemeStatusBar() {
  const mode = useThemeMode();
  return <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />;
}
