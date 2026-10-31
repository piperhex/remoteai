import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
import { updateThemeMode } from '../theme/store';
import { Platform } from 'react-native';

vi.mock('react', async original => ({ ...await original<typeof React>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('react-native', () => ({ Modal: 'NativeModal', Platform: { OS: 'android' } }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: 'SafeAreaProvider' }));
vi.mock('./ModalSystemBars', () => ({ ModalSystemBars: 'ModalSystemBars' }));
beforeEach(() => { vi.stubGlobal('React', React); updateThemeMode('light'); Platform.OS = 'android'; });
afterEach(() => { updateThemeMode('light'); vi.unstubAllGlobals(); });

it('updates the open window appearance with the theme and preserves explicit preview contrast', () => {
  const appearance = (override?: 'light' | 'dark') =>
    Modal({ statusBarStyle: override }).props.children.props.children[0].props.style;
  expect(appearance()).toBe('dark');
  expect(appearance('light')).toBe('light');
  updateThemeMode('dark');
  expect(appearance()).toBe('light');
  expect(appearance('dark')).toBe('dark');
});

it('preserves modal visibility, close, presentation and immersion ownership', () => {
  const close = vi.fn();
  const onShow = vi.fn();
  const props = Modal({ visible: false, onRequestClose: close, onShow, transparent: true,
    presentationStyle: 'fullScreen', children: 'content' }).props;
  expect(props).toMatchObject({ visible: false, onShow, onRequestClose: close,
    transparent: true, presentationStyle: 'fullScreen', statusBarTranslucent: true });
  expect(props.navigationBarTranslucent).toBeUndefined();
  expect(props).not.toHaveProperty('hidden');
  expect(props.children.props.children[1]).toBe('content');
  const opaque = Modal({ statusBarTranslucent: false }).props;
  expect(opaque.statusBarTranslucent).toBe(false);
  expect(opaque.navigationBarTranslucent).toBeUndefined();
  expect(Modal({ navigationBarTranslucent: true }).props.navigationBarTranslucent).toBe(true);
  expect(Modal({ navigationBarTranslucent: false }).props.navigationBarTranslucent).toBe(false);
});

it('keeps the existing iOS presentation and system-bar behavior', () => {
  Platform.OS = 'ios';
  const props = Modal({ children: 'content', statusBarStyle: 'light' }).props;
  expect(props.children).toBe('content');
  expect(props.statusBarTranslucent).toBeUndefined();
  expect(props.navigationBarTranslucent).toBeUndefined();
});
