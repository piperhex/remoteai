import { requireNativeComponent, type ViewProps } from 'react-native';

const NativeSystemBars = requireNativeComponent<ViewProps & { darkIcons: boolean }>('ModalSystemBars');

/** Target the dialog window; React Native's StatusBar only updates the underlying Activity. */
export function ModalSystemBars({ style }: { style: 'light' | 'dark' }) {
  return <NativeSystemBars darkIcons={style === 'dark'} pointerEvents="none" accessible={false}
    importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', width: 0, height: 0 }} />;
}
