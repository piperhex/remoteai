import { Modal as NativeModal, Platform, type ModalProps } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useThemeMode } from '../theme/store';
import { ModalSystemBars } from './ModalSystemBars';

type Props = ModalProps & { statusBarStyle?: 'light' | 'dark' };

/** Give every overlay its own system-bar appearance and safe-area measurements. */
export function Modal({ children, statusBarStyle, statusBarTranslucent,
  navigationBarTranslucent, ...props }: Props) {
  const theme = useThemeMode();
  if (Platform.OS !== 'android') return <NativeModal {...props} statusBarTranslucent={statusBarTranslucent}
    navigationBarTranslucent={navigationBarTranslucent}>{children}</NativeModal>;
  // Preserve navigation-bar opt-ins: Android needs a fitted window for keyboard resize.
  return <NativeModal {...props} statusBarTranslucent={statusBarTranslucent ?? true}
    navigationBarTranslucent={navigationBarTranslucent}>
    <SafeAreaProvider>
      <ModalSystemBars style={statusBarStyle ?? (theme === 'dark' ? 'light' : 'dark')} />
      {children}
    </SafeAreaProvider>
  </NativeModal>;
}
